import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { GoTestExplorer } from '../goTestExplorer';
import { TestNode } from '../testNode';
import { TestResult } from '../testResult';
import { RawTestResult } from '../rawTestResult';
import { __reset, Uri } from './mocks/vscode';

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
