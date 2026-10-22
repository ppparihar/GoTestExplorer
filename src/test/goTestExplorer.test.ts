import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { GoTestExplorer } from '../goTestExplorer';
import { TestNode } from '../testNode';
import { TestResult } from '../testResult';
import { RawTestResult } from '../rawTestResult';
import { __reset, __setDocumentText, __state, Uri } from './mocks/vscode';

const runGoTest = vi.fn();

vi.mock('../lib/testUtil', async importOriginal => {
	const actual = await importOriginal<typeof import('../lib/testUtil')>();
	return {
		...actual,
		runGoTest: (...args: unknown[]) => runGoTest(...args)
	};
});

function fakeContext(): vscode.ExtensionContext {
	return {
		subscriptions: [],
		asAbsolutePath: (relativePath: string) => relativePath
	} as unknown as vscode.ExtensionContext;
}

const fileUri = Uri.file('/repo/pkg/alpha_test.go');

describe('GoTestExplorer', () => {
	let explorer: GoTestExplorer;
	let results: TestResult[];

	beforeEach(() => {
		__reset();
		runGoTest.mockReset();
		runGoTest.mockResolvedValue(new RawTestResult(true, ['ok'], []));
		explorer = new GoTestExplorer(fakeContext());
		results = [];
		explorer.commands.testResult((r: TestResult) => results.push(r));
	});

	it('reports a passing result for the test that was run', async () => {
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => results.length > 0);

		expect(results.some(r => r.testName === 'TestAlpha' && r.isPassed)).toBe(true);
	});

	it('reports the suite alongside the individual test', async () => {
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => results.length > 0);

		expect(results.some(r => r.testName === 'alpha_test.go')).toBe(true);
	});

	it('runs the named test only', async () => {
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => runGoTest.mock.calls.length > 0);

		const config = runGoTest.mock.calls[0][0];
		expect(config.functions).toEqual(['TestAlpha']);
		expect(config.testUri.fsPath).toBe(fileUri.fsPath);
		expect(config.dir).toBe('/repo/pkg');
	});

	it('runs every child of a suite', async () => {
		const suite = new TestNode('alpha_test.go', fileUri, [
			new TestNode('TestAlpha', fileUri),
			new TestNode('TestBeta', fileUri)
		]);
		await explorer.onRunSingleTest(suite);

		await waitFor(() => runGoTest.mock.calls.length > 0);

		const config = runGoTest.mock.calls[0][0];
		expect(config.functions).toEqual(['TestAlpha', 'TestBeta']);
	});

	it('reports the tests of a suite as one run', async () => {
		const suite = new TestNode('alpha_test.go', fileUri, [
			new TestNode('TestAlpha', fileUri),
			new TestNode('TestBeta', fileUri)
		]);
		const started: TestNode[][] = [];
		explorer.commands.testRunStarted(nodes => started.push(nodes));

		await vscode.commands.executeCommand('goTestExplorer.runTestSuite', suite);

		expect(started.length).toBe(1);
		expect(started[0].map(node => node.name)).toEqual(['TestAlpha', 'TestBeta', 'alpha_test.go']);
	});

	it('marks the tests as failed when the run fails', async () => {
		runGoTest.mockResolvedValue(new RawTestResult(false, ['--- FAIL: TestAlpha'], ['TestAlpha']));
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => results.length > 0);

		const alpha = results.find(r => r.testName === 'TestAlpha');
		expect(alpha.isPassed).toBe(false);
	});

	it('marks the tests as failed when the run throws', async () => {
		runGoTest.mockRejectedValue(new Error('boom'));
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => results.length > 0);

		const alpha = results.find(r => r.testName === 'TestAlpha');
		expect(alpha.isPassed).toBe(false);
		expect(alpha.output.join('\n')).toContain('boom');
	});

	it('marks a test as failed when one of its subtests failed', async () => {
		// The tool reports the subtest that failed. The test that holds it
		// failed too, so it must not be reported as passed.
		runGoTest.mockResolvedValue(new RawTestResult(false, ['--- FAIL: TestAlpha/sub'], ['TestAlpha/sub']));
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => results.length > 0);

		const alpha = results.find(r => r.testName === 'TestAlpha');
		expect(alpha.isPassed).toBe(false);
	});

	it('does not mark a test as failed when a different test failed', async () => {
		runGoTest.mockResolvedValue(new RawTestResult(false, ['--- FAIL: TestOther'], ['TestOther']));
		const node = new TestNode('TestAlpha', fileUri);
		await explorer.onRunSingleTest(node);

		await waitFor(() => results.length > 0);

		const alpha = results.find(r => r.testName === 'TestAlpha');
		expect(alpha.isPassed).toBe(true);
	});

	it('says that nothing was running when the run is cancelled and nothing is', async () => {
		await vscode.commands.executeCommand('goTestExplorer.cancelTestRun');

		expect(__state.messages.info.length).toBe(1);
		expect(__state.messages.info[0]).toContain('No test run is in progress');
	});
});

describe('GoTestExplorer go-to-location', () => {
	let explorer: GoTestExplorer;
	let editor: { document: { uri: vscode.Uri }; selection: vscode.Selection; revealRange: (r: vscode.Range) => void };

	beforeEach(() => {
		__reset();
		explorer = new GoTestExplorer(fakeContext());
		editor = {
			document: { uri: fileUri },
			selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
			revealRange: vi.fn()
		};
		__state.activeTextEditor = editor as never;
	});

	it('selects the name of the test in the open document', async () => {
		__setDocumentText(fileUri.fsPath, [
			'package pkg',
			'',
			'func TestAlpha(t *testing.T) {',
			'\tt.Log("hello")',
			'}'
		].join('\n'));

		await explorer.go(new TestNode('TestAlpha', fileUri));

		expect(editor.selection.start.line).toBe(2);
		expect(editor.selection.start.character).toBe(5);
		expect(editor.selection.end.character).toBe(14);
	});

	it('finds a test in an unsaved edit', async () => {
		// The document on disk still has the old name; the buffer has the new
		// one. Go-to-location must follow the buffer.
		__setDocumentText(fileUri.fsPath, [
			'package pkg',
			'',
			'func TestRenamed(t *testing.T) {}'
		].join('\n'));

		await explorer.go(new TestNode('TestRenamed', fileUri));

		expect(editor.selection.start.line).toBe(2);
		expect(editor.selection.start.character).toBe(5);
	});

	it('warns when the test is not in the document', async () => {
		__setDocumentText(fileUri.fsPath, 'package pkg\n\nfunc TestOther(t *testing.T) {}\n');

		await explorer.go(new TestNode('TestAlpha', fileUri));

		expect(__state.messages.warning.length).toBe(1);
		expect(__state.messages.warning[0]).toContain('Could not find test');
	});
});

async function waitFor(predicate: () => boolean, timeoutMs: number = 5000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('timed out waiting for condition');
		}
		await new Promise(r => setTimeout(r, 5));
	}
}
