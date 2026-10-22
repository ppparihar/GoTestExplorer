import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoTestExplorer } from '../goTestExplorer';
import { TestNode } from '../testNode';
import { TestResult } from '../testResult';
import { RawTestResult } from '../rawTestResult';
import { PackageResult } from '../exec/goTestJsonParser';
import { __reset, __setDocumentText, __state, Uri } from './mocks/vscode';
import { testOutput } from '../lib/testOutput';

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

	it('cancels the run when the user presses Ctrl+C in the terminal', async () => {
		// The terminal of the output is made when something is written to it.
		testOutput.writeLine('running');
		const terminal = __state.terminals[__state.terminals.length - 1];

		terminal.sendText('\x03');

		expect(__state.messages.info.length).toBe(1);
		expect(__state.messages.info[0]).toContain('No test run is in progress');
	});
});

describe('GoTestExplorer runs a whole module', () => {
	let explorer: GoTestExplorer;
	let moduleDir: string;
	let results: TestResult[];
	let completed: vscode.Uri[][];

	/**
	 * A file that holds tests, in the package of the directory it is in.
	 */
	function suiteIn(dir: string, name: string, tests: string[]): TestNode {
		fs.mkdirSync(dir, { recursive: true });
		const uri = Uri.file(path.join(dir, name));
		return new TestNode(name, uri, tests.map(test => new TestNode(test, uri)));
	}

	beforeEach(() => {
		__reset();
		runGoTest.mockReset();
		runGoTest.mockResolvedValue(new RawTestResult(true, ['ok'], []));
		explorer = new GoTestExplorer(fakeContext());
		results = [];
		completed = [];
		explorer.commands.testResult((r: TestResult) => results.push(r));
		explorer.commands.testCompleted((uris: vscode.Uri[]) => completed.push(uris));
		moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-explorer-module-'));
		fs.writeFileSync(path.join(moduleDir, 'go.mod'), 'module example.com/mod\n');
	});

	afterEach(() => {
		fs.rmSync(moduleDir, { recursive: true, force: true });
	});

	it('runs every package of a module in one process', async () => {
		const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestA']);
		const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestB']);
		explorer.commands.sendDiscoveredTests([a, b]);

		await vscode.commands.executeCommand('goTestExplorer.runAllTest');
		await waitFor(() => runGoTest.mock.calls.length > 0);

		expect(runGoTest.mock.calls.length).toBe(1);
		const config = runGoTest.mock.calls[0][0];
		expect(config.dir).toBe(moduleDir);
		expect(config.packages.map((p: { importPath: string }) => p.importPath)).toEqual([
			'example.com/mod/pkg/a',
			'example.com/mod/pkg/b'
		]);
		expect(config.packages.map((p: { path: string }) => p.path)).toEqual(['pkg/a', 'pkg/b']);
	});

	it('runs the files of one package in one process', async () => {
		const dir = path.join(moduleDir, 'pkg');
		const a = suiteIn(dir, 'a_test.go', ['TestA']);
		const b = suiteIn(dir, 'b_test.go', ['TestB']);
		explorer.commands.sendDiscoveredTests([a, b]);

		await vscode.commands.executeCommand('goTestExplorer.runAllTest');
		await waitFor(() => runGoTest.mock.calls.length > 0);

		expect(runGoTest.mock.calls.length).toBe(1);
		const config = runGoTest.mock.calls[0][0];
		expect(config.packages.length).toBe(1);
		expect(config.packages[0].files.map((f: { name: string }) => f.name)).toEqual(['a_test.go', 'b_test.go']);
	});

	it('attributes the outcome of a test to the package it belongs to', async () => {
		const packages = new Map<string, PackageResult>();
		packages.set('example.com/mod/pkg/a', {
			package: 'example.com/mod/pkg/a',
			tests: new Map(),
			failedTests: ['TestA'],
			output: ['a output'],
			failed: true,
			buildFailed: false
		});
		packages.set('example.com/mod/pkg/b', {
			package: 'example.com/mod/pkg/b',
			tests: new Map(),
			failedTests: [],
			output: ['b output'],
			failed: false,
			buildFailed: false
		});
		runGoTest.mockResolvedValue(new RawTestResult(false, [], ['TestA'], undefined, packages));

		const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestA']);
		const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestB']);
		explorer.commands.sendDiscoveredTests([a, b]);

		await vscode.commands.executeCommand('goTestExplorer.runAllTest');
		await waitFor(() => results.length > 0);

		expect(results.find(r => r.testName === 'TestA')?.isPassed).toBe(false);
		expect(results.find(r => r.testName === 'TestB')?.isPassed).toBe(true);
		expect(results.find(r => r.testName === 'TestA')?.output).toEqual(['a output']);
		expect(results.find(r => r.testName === 'TestB')?.output).toEqual(['b output']);
	});

	it('reports the outcome of every file of the run', async () => {
		const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestA']);
		const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestB']);
		explorer.commands.sendDiscoveredTests([a, b]);

		await vscode.commands.executeCommand('goTestExplorer.runAllTest');
		await waitFor(() => completed.length > 0);

		expect(completed.length).toBe(1);
		expect(completed[0].map(uri => path.basename(uri.fsPath))).toEqual(['a_test.go', 'b_test.go']);
	});

	it('runs the files that are not in a module one by one', async () => {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-explorer-nomodule-'));
		try {
			const a = suiteIn(outside, 'a_test.go', ['TestA']);
			const b = suiteIn(outside, 'b_test.go', ['TestB']);
			explorer.commands.sendDiscoveredTests([a, b]);

			await vscode.commands.executeCommand('goTestExplorer.runAllTest');
			await waitFor(() => runGoTest.mock.calls.length > 1);

			expect(runGoTest.mock.calls.length).toBe(2);
			expect(runGoTest.mock.calls[0][0].packages).toBeUndefined();
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
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
