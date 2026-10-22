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

	it('returns the discovered nodes as the tree root', () => {
		commands.sendDiscoveredTests([buildSuite()]);
		return provider.getChildren().then(children => {
			expect(children.length).toBe(1);
			expect(children[0].name).toBe('alpha_test.go');
		});
	});
});
