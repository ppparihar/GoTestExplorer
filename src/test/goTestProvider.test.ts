import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { GoTestProvider } from '../goTestProvider';
import { TestNode } from '../testNode';
import { TestResult } from '../testResult';
import { Uri } from './mocks/vscode';
import { Icons } from '../icons';
import { Config } from '../config';
import { __setConfiguration, __state } from './mocks/vscode';

const fileUri = Uri.file('/repo/alpha_test.go');

function fakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    asAbsolutePath: (relativePath: string) => relativePath,
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

  it('shows only the tests that match the filter', async () => {
    const other = new TestNode('TestBeta', fileUri);
    const suite = new TestNode('alpha_test.go', fileUri, [
      new TestNode('TestAlpha', fileUri),
      other,
    ]);
    commands.sendDiscoveredTests([suite]);

    provider.filter = 'beta';

    const [file] = await provider.getChildren();
    expect(file).toBe(suite);
    expect((await provider.getChildren(file)).map((n) => n.name)).toEqual(['TestBeta']);

    provider.filter = 'nothing';
    expect(await provider.getChildren()).toEqual([]);

    provider.filter = '';
    expect((await provider.getChildren(suite)).length).toBe(2);
  });

  it('shows a file with no test function as a file, not as a test', () => {
    // `testHealth(t)` is a helper that another test runs, so the file has no
    // Test function and the scan found nothing in it.
    const file = new TestNode('health_test.go', fileUri, []);
    commands.sendDiscoveredTests([file]);

    const item = provider.getTreeItem(file);

    // There is no run button, because the context is neither test nor suite.
    expect(item.contextValue).toBe('emptyTestFile');
    expect(item.description).toBe('no tests');
    // A click opens the file, and does not look for a test named like it.
    expect((item.command as { command: string }).command).toBe('vscode.open');
    expect((item.command as { arguments: unknown[] }).arguments[0]).toBe(fileUri);
  });

  it('leaves a file with no test function out of the list, unless asked to show it', async () => {
    const helpers = new TestNode('health_test.go', fileUri, []);
    const suite = buildSuite();
    commands.sendDiscoveredTests([helpers, suite]);

    expect(await provider.getChildren()).toEqual([suite]);

    // Run All and the like read the same list, and never see the empty file.
    __setConfiguration('goTestExplorer', { showFilesWithoutTests: true });
    let redrawn = 0;
    provider.onDidChangeTreeData(() => redrawn++);
    __state.configListeners.forEach((listener) =>
      listener({
        affectsConfiguration: (section) => section === 'goTestExplorer.showFilesWithoutTests',
      }),
    );

    expect(redrawn).toBe(1);
    expect(await provider.getChildren()).toEqual([helpers, suite]);
    __setConfiguration('goTestExplorer', {});
  });

  it('shows a file that the build tags leave out as such, without its tests', async () => {
    const fn = new TestNode('TestFunctional', fileUri);
    const file = new TestNode('functional_test.go', fileUri, [fn], 'functional');
    commands.sendDiscoveredTests([file]);

    // No tag is set, so go test would leave the file out.
    expect(provider.isExcluded(file)).toBe(true);
    const item = provider.getTreeItem(file);
    expect(item.contextValue).toBe('excludedTestFile');
    expect(item.description).toBe('needs build tags');
    expect(String(item.tooltip)).toContain('//go:build functional');
    expect((item.command as { command: string }).command).toBe('vscode.open');
    expect(await provider.getChildren(file)).toEqual([]);

    // With the tag set it is an ordinary file again, and the row redraws.
    __setConfiguration('goTestExplorer', { buildTags: 'functional' });
    let redrawn = 0;
    provider.onDidChangeTreeData(() => redrawn++);
    __state.configListeners.forEach((listener) =>
      listener({ affectsConfiguration: (section) => section === 'goTestExplorer.buildTags' }),
    );
    expect(redrawn).toBe(1);
    expect(provider.isExcluded(file)).toBe(false);
    expect(provider.getTreeItem(file).contextValue).toBe('testSuite');
    expect(await provider.getChildren(file)).toEqual([fn]);
    __setConfiguration('goTestExplorer', {});
  });

  it('still treats a single test as a test', () => {
    const test = new TestNode('TestAlpha', fileUri);

    const item = provider.getTreeItem(test);

    expect(item.contextValue).toBe('test');
    expect((item.command as { command: string }).command).toBe('goTestExplorer.goToLocation');
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
    expect(provider.discoveredTests[0].children.map((c) => c.name)).toEqual(['TestBravo']);
  });

  it('adds a file that was created', () => {
    commands.sendDiscoveredTests([]);

    const other = Uri.file('/repo/beta_test.go');
    commands.sendTestFileChanged(
      new TestNode('beta_test.go', other, [new TestNode('TestBeta', other)]),
    );

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
    return provider.getChildren().then((children) => {
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
    provider.onDidChangeTreeData((node) => {
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
    provider.onDidChangeTreeData((node) => {
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

describe('GoTestProvider shows a test as soon as it finishes', () => {
  let commands: Commands;
  let provider: GoTestProvider;
  let redrawn: (TestNode | undefined)[];

  beforeEach(() => {
    vi.useFakeTimers();
    commands = new Commands();
    provider = new GoTestProvider(fakeContext(), commands);
    redrawn = [];
    commands.sendDiscoveredTests([buildSuite()]);
    provider.onDidChangeTreeData((node) => {
      redrawn.push(node);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies the outcome and ends the spinner of the test', () => {
    const suite = provider.discoveredTests[0];
    commands.sendTestRunStarted([suite.children[0], suite]);
    expect(suite.children[0].isLoading).toBe(true);

    commands.sendTestOutcome(new TestResult(fileUri, 'TestAlpha', false, []));

    expect(suite.children[0].isLoading).toBe(false);
    expect(suite.children[0].testResult.isPassed).toBe(false);
  });

  it('redraws the suite of the test, once, after a short wait', () => {
    const suite = provider.discoveredTests[0];
    redrawn.length = 0;

    commands.sendTestOutcome(new TestResult(fileUri, 'TestAlpha', true, []));
    expect(redrawn).toEqual([]);

    vi.advanceTimersByTime(Config.OutcomeRedrawDelay);

    expect(redrawn).toEqual([suite]);
  });

  it('redraws a suite once for all the tests that finished in the same moment', () => {
    const suite = new TestNode('alpha_test.go', fileUri, [
      new TestNode('TestOne', fileUri),
      new TestNode('TestTwo', fileUri),
      new TestNode('TestThree', fileUri),
    ]);
    commands.sendDiscoveredTests([suite]);
    redrawn.length = 0;

    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestTwo', true, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestThree', false, []));
    vi.advanceTimersByTime(Config.OutcomeRedrawDelay);

    expect(redrawn).toEqual([suite]);
    expect(suite.children.map((child) => child.testResult.isPassed)).toEqual([true, true, false]);
  });

  it('shows a result no later than the wait, however many tests keep finishing', () => {
    const suite = provider.discoveredTests[0];
    redrawn.length = 0;

    // A test finishes every 10 ms. The wait is not extended by the next one.
    for (let tick = 0; tick < 10; tick++) {
      commands.sendTestOutcome(new TestResult(fileUri, 'TestAlpha', true, []));
      vi.advanceTimersByTime(10);
    }

    expect(redrawn.length).toBeGreaterThanOrEqual(1);
    expect(redrawn.every((node) => node === suite)).toBe(true);
    // 100 ms passed, so the redraws are a handful, not one per test.
    expect(redrawn.length).toBeLessThan(10);
  });

  it('redraws each suite that finished a test, once', () => {
    const second = new TestNode('beta_test.go', Uri.file('/repo/beta_test.go'), [
      new TestNode('TestBeta', Uri.file('/repo/beta_test.go')),
    ]);
    commands.sendDiscoveredTests([provider.discoveredTests[0], second]);
    redrawn.length = 0;

    commands.sendTestOutcome(new TestResult(fileUri, 'TestAlpha', true, []));
    commands.sendTestOutcome(new TestResult(second.uri, 'TestBeta', true, []));
    vi.advanceTimersByTime(Config.OutcomeRedrawDelay);

    expect(redrawn.length).toBe(2);
  });

  it('redraws the whole tree once when many suites changed', () => {
    const suites = Array.from({ length: Config.OutcomeRedrawMaxSuites + 1 }, (_, index) => {
      const uri = Uri.file(`/repo/f${index}_test.go`);
      return new TestNode(`f${index}_test.go`, uri, [new TestNode('TestX', uri)]);
    });
    commands.sendDiscoveredTests(suites);
    redrawn.length = 0;

    suites.forEach((suite) =>
      commands.sendTestOutcome(new TestResult(suite.uri, 'TestX', true, [])),
    );
    vi.advanceTimersByTime(Config.OutcomeRedrawDelay);

    expect(redrawn).toEqual([undefined]);
  });

  it('does not draw a result twice when its run completes inside the wait', () => {
    const suite = provider.discoveredTests[0];
    redrawn.length = 0;

    commands.sendTestOutcome(new TestResult(fileUri, 'TestAlpha', true, []));
    commands.sendTestCompleted([fileUri]);
    vi.advanceTimersByTime(Config.OutcomeRedrawDelay * 4);

    // Only the redraw of the end of the run.
    expect(redrawn).toEqual([suite]);
  });

  it('draws the results of another run that is still going when a run completes', () => {
    const other = new TestNode('beta_test.go', Uri.file('/repo/beta_test.go'), [
      new TestNode('TestBeta', Uri.file('/repo/beta_test.go')),
    ]);
    const first = provider.discoveredTests[0];
    commands.sendDiscoveredTests([first, other]);
    redrawn.length = 0;

    commands.sendTestOutcome(new TestResult(other.uri, 'TestBeta', true, []));
    commands.sendTestCompleted([fileUri]);

    // The other run's result is drawn now, and the finished run's file once.
    expect(redrawn).toContain(other);
    expect(redrawn).toContain(first);
    vi.advanceTimersByTime(Config.OutcomeRedrawDelay * 4);
    expect(redrawn.filter((node) => node === other).length).toBe(1);
  });

  it('draws nothing after a full redraw has covered the waiting results', () => {
    commands.sendTestOutcome(new TestResult(fileUri, 'TestAlpha', true, []));
    commands.sendTestDiscoveryStarted();
    redrawn.length = 0;

    vi.advanceTimersByTime(Config.OutcomeRedrawDelay * 4);

    expect(redrawn).toEqual([]);
  });

  it('leaves the other tests of the run spinning', () => {
    const suite = new TestNode('beta_test.go', fileUri, [
      new TestNode('TestOne', fileUri),
      new TestNode('TestTwo', fileUri),
    ]);
    commands.sendDiscoveredTests([suite]);
    commands.sendTestRunStarted([...suite.children, suite]);

    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));

    expect(suite.children[0].isLoading).toBe(false);
    expect(suite.children[1].isLoading).toBe(true);
  });
});

describe('GoTestProvider ends the spinner of a suite when its last test finishes', () => {
  let commands: Commands;
  let provider: GoTestProvider;
  let suite: TestNode;

  beforeEach(() => {
    vi.useFakeTimers();
    commands = new Commands();
    provider = new GoTestProvider(fakeContext(), commands);
    suite = new TestNode('alpha_test.go', fileUri, [
      new TestNode('TestOne', fileUri),
      new TestNode('TestTwo', fileUri),
    ]);
    commands.sendDiscoveredTests([suite]);
    // A run of the whole suite marks every test and the suite itself as running.
    commands.sendTestRunStarted([...suite.children, suite]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the suite running while one of its tests is still running', () => {
    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));

    expect(suite.icon).toBe(Icons.loading);
  });

  it('shows the suite as passed as soon as its last test has passed', () => {
    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestTwo', true, []));

    // The run has not finished: no result of the suite has arrived.
    expect(suite.isLoading).toBe(false);
    expect(suite.icon).toBe(Icons.testSuitePassed);
  });

  it('shows the suite as failed as soon as its last test is done, if one failed', () => {
    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', false, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestTwo', true, []));

    expect(suite.icon).toBe(Icons.testSuiteFailed);
  });

  it('does not depend on the order the tests finish in', () => {
    commands.sendTestOutcome(new TestResult(fileUri, 'TestTwo', true, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));

    expect(suite.icon).toBe(Icons.testSuitePassed);
  });

  it('leaves another suite that is still running alone', () => {
    const otherUri = Uri.file('/repo/beta_test.go');
    const other = new TestNode('beta_test.go', otherUri, [new TestNode('TestBeta', otherUri)]);
    commands.sendDiscoveredTests([suite, other]);
    commands.sendTestRunStarted([...suite.children, suite, ...other.children, other]);

    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestTwo', true, []));

    expect(suite.icon).toBe(Icons.testSuitePassed);
    expect(other.icon).toBe(Icons.loading);
  });

  it('redraws the suite so the new icon shows', () => {
    const redrawn: (TestNode | undefined)[] = [];
    provider.onDidChangeTreeData((node) => {
      redrawn.push(node);
    });

    commands.sendTestOutcome(new TestResult(fileUri, 'TestOne', true, []));
    commands.sendTestOutcome(new TestResult(fileUri, 'TestTwo', true, []));
    // The redraw is batched, so it comes after the short wait.
    vi.advanceTimersByTime(Config.OutcomeRedrawDelay);

    expect(redrawn[redrawn.length - 1]).toBe(suite);
  });
});
