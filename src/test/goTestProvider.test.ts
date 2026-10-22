import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { GoTestProvider } from '../goTestProvider';
import { TestNode } from '../testNode';
import { TestResult } from '../testResult';
import { Uri } from './mocks/vscode';

const fileUri = Uri.file('/repo/alpha_test.go');

function fakeContext(): vscode.ExtensionContext {
	return {
		subscriptions: [],
		asAbsolutePath: (relativePath: string) => relativePath
	} as unknown as vscode.ExtensionContext;
}

function buildSuite(): TestNode {
	const child = new TestNode('TestAlpha', fileUri);
	return new TestNode('alpha_test.go', fileUri, [child]);
}

describe('GoTestProvider', () => {
	let commands: Commands;
	let provider: GoTestProvider;

	beforeEach(() => {
		commands = new Commands();
		provider = new GoTestProvider(fakeContext(), commands);
	});

	it('applies a test result to the matching node', () => {
		commands.sendDiscoveredTests([buildSuite()]);

		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', true, []));

		const suite = provider.discoveredTests[0];
		expect(suite.children[0].testResult).toBeDefined();
		expect(suite.children[0].testResult.isPassed).toBe(true);
	});

	it('keeps results across a refresh', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', true, []));

		// A refresh rebuilds the tree from freshly discovered nodes.
		commands.sendTestDiscoveryStarted();
		commands.sendDiscoveredTests([buildSuite()]);

		const suite = provider.discoveredTests[0];
		expect(suite.children[0].testResult).toBeDefined();
		expect(suite.children[0].testResult.isPassed).toBe(true);
	});

	it('keeps a failed result across a refresh', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', false, ['boom']));

		commands.sendTestDiscoveryStarted();
		commands.sendDiscoveredTests([buildSuite()]);

		const suite = provider.discoveredTests[0];
		expect(suite.children[0].testResult.isPassed).toBe(false);
	});

	it('does not carry a result over to a different test', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', true, []));

		commands.sendTestDiscoveryStarted();
		const other = new TestNode('TestBeta', fileUri);
		commands.sendDiscoveredTests([new TestNode('alpha_test.go', fileUri, [other])]);

		expect(provider.discoveredTests[0].children[0].testResult).toBeUndefined();
	});

	it('reports a suite as failed when one of its children failed', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', false, []));

		expect(provider.discoveredTests[0].icon).toBe('testSuiteFailed.svg');
	});

	it('clears the tree while a new discovery is running', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		commands.sendTestDiscoveryStarted();

		expect(provider.discoveredTests).toEqual([]);
	});

	it('replaces the node for a file that changed', () => {
		commands.sendDiscoveredTests([buildSuite()]);

		const updated = new TestNode('alpha_test.go', fileUri, [new TestNode('TestBravo', fileUri)]);
		commands.sendTestFileChanged(updated);

		expect(provider.discoveredTests.length).toBe(1);
		expect(provider.discoveredTests[0].children.map(c => c.name)).toEqual(['TestBravo']);
	});

	it('adds a file that was created', () => {
		commands.sendDiscoveredTests([]);

		const other = Uri.file('/repo/beta_test.go');
		commands.sendTestFileChanged(new TestNode('beta_test.go', other, [new TestNode('TestBeta', other)]));

		expect(provider.discoveredTests.length).toBe(1);
		expect(provider.discoveredTests[0].name).toBe('beta_test.go');
	});

	it('keeps the outcome of a test across a change to its file', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', true, []));

		const updated = new TestNode('alpha_test.go', fileUri, [new TestNode('TestAlpha', fileUri)]);
		commands.sendTestFileChanged(updated);

		expect(provider.discoveredTests[0].children[0].testResult).toBeDefined();
		expect(provider.discoveredTests[0].children[0].testResult.isPassed).toBe(true);
	});

	it('forgets a test the file no longer declares', () => {
		commands.sendDiscoveredTests([buildSuite()]);

		const updated = new TestNode('alpha_test.go', fileUri, [new TestNode('TestBravo', fileUri)]);
		commands.sendTestFileChanged(updated);

		expect(provider.getDiscoveredTestNode(fileUri.fsPath + '__TestAlpha')).toBeUndefined();
		expect(provider.getDiscoveredTestNode(fileUri.fsPath + '__TestBravo')).toBeDefined();
	});

	it('drops the node for a file that was removed', () => {
		commands.sendDiscoveredTests([buildSuite()]);

		commands.sendTestFileRemoved(fileUri.fsPath);

		expect(provider.discoveredTests.length).toBe(0);
		expect(provider.getDiscoveredTestNode(fileUri.fsPath + '__TestAlpha')).toBeUndefined();
	});

	it('returns the discovered nodes as the tree root', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		return provider.getChildren().then(children => {
			expect(children.length).toBe(1);
			expect(children[0].name).toBe('alpha_test.go');
		});
	});
});

describe('GoTestProvider refreshes', () => {
	let commands: Commands;
	let provider: GoTestProvider;
	let refreshes: number;
	let refreshed: (TestNode | undefined)[];

	beforeEach(() => {
		commands = new Commands();
		provider = new GoTestProvider(fakeContext(), commands);
		commands.sendDiscoveredTests([buildSuite()]);
		refreshes = 0;
		refreshed = [];
		provider.onDidChangeTreeData(node => {
			refreshes++;
			refreshed.push(node);
		});
	});

	it('redraws the tree once for a run, not once per test', () => {
		const suite = provider.discoveredTests[0];

		commands.sendTestRunStarted([suite.children[0], suite]);
		expect(refreshes).toBe(1);

		// The outcome of every test of the run arrives one after the other.
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', true, []));
		commands.sendTestResult(new TestResult(fileUri, 'alpha_test.go', true, []));
		expect(refreshes).toBe(1);

		commands.sendTestCompleted([fileUri]);
		expect(refreshes).toBe(2);
	});

	it('redraws the node that holds the tests', () => {
		commands.sendTestCompleted([fileUri]);

		expect(refreshed[0].name).toBe('alpha_test.go');
	});

	it('marks the tests of a run as running', () => {
		const suite = provider.discoveredTests[0];

		commands.sendTestRunStarted([suite.children[0], suite]);

		expect(suite.children[0].isLoading).toBe(true);
	});

	it('shows the outcome of a run when it finishes', () => {
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', false, ['boom']));
		commands.sendTestCompleted([fileUri]);

		const suite = provider.discoveredTests[0];
		expect(suite.children[0].testResult.isPassed).toBe(false);
		expect(suite.icon).toBe('testSuiteFailed.svg');
	});
});

describe('GoTestProvider redraws a run that covers several files', () => {
	let commands: Commands;
	let provider: GoTestProvider;
	let refreshes: number;
	let refreshed: (TestNode | undefined)[];

	const otherUri = Uri.file('/repo/beta_test.go');

	beforeEach(() => {
		commands = new Commands();
		provider = new GoTestProvider(fakeContext(), commands);
		const alpha = buildSuite();
		const beta = new TestNode('beta_test.go', otherUri, [new TestNode('TestBeta', otherUri)]);
		commands.sendDiscoveredTests([alpha, beta]);
		refreshes = 0;
		refreshed = [];
		provider.onDidChangeTreeData(node => {
			refreshes++;
			refreshed.push(node);
		});
	});

	it('redraws the whole tree once, not once per file', () => {
		const alpha = provider.discoveredTests[0];
		const beta = provider.discoveredTests[1];

		commands.sendTestRunStarted([alpha.children[0], alpha, beta.children[0], beta]);

		expect(refreshes).toBe(1);
		// The run spans two suites, so there is no single node to redraw.
		expect(refreshed[0]).toBeUndefined();
	});

	it('redraws the whole tree once when the run finishes', () => {
		commands.sendTestResult(new TestResult(fileUri, 'TestAlpha', true, []));
		commands.sendTestResult(new TestResult(otherUri, 'TestBeta', true, []));

		commands.sendTestCompleted([fileUri, otherUri]);

		expect(refreshes).toBe(1);
		expect(refreshed[0]).toBeUndefined();
	});
});
