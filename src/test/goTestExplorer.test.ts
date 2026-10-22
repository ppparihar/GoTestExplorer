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
import { __reset, __setConfiguration, __setDocumentText, __state, Uri } from './mocks/vscode';
import { testOutput } from '../lib/testOutput';

const runGoTest = vi.fn();

vi.mock('../lib/testUtil', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/testUtil')>();
  return {
    ...actual,
    runGoTest: (...args: unknown[]) => runGoTest(...args),
  };
});

function fakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    asAbsolutePath: (relativePath: string) => relativePath,
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

    expect(results.some((r) => r.testName === 'TestAlpha' && r.isPassed)).toBe(true);
  });

  it('reports the suite alongside the individual test', async () => {
    const node = new TestNode('TestAlpha', fileUri);
    await explorer.onRunSingleTest(node);

    await waitFor(() => results.length > 0);

    expect(results.some((r) => r.testName === 'alpha_test.go')).toBe(true);
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
      new TestNode('TestBeta', fileUri),
    ]);
    await explorer.onRunSingleTest(suite);

    await waitFor(() => runGoTest.mock.calls.length > 0);

    const config = runGoTest.mock.calls[0][0];
    expect(config.functions).toEqual(['TestAlpha', 'TestBeta']);
  });

  it('reports the tests of a suite as one run', async () => {
    const suite = new TestNode('alpha_test.go', fileUri, [
      new TestNode('TestAlpha', fileUri),
      new TestNode('TestBeta', fileUri),
    ]);
    const started: TestNode[][] = [];
    explorer.commands.testRunStarted((nodes) => started.push(nodes));

    await vscode.commands.executeCommand('goTestExplorer.runTestSuite', suite);

    expect(started.length).toBe(1);
    expect(started[0].map((node) => node.name)).toEqual(['TestAlpha', 'TestBeta', 'alpha_test.go']);
  });

  it('marks the tests as failed when the run fails', async () => {
    runGoTest.mockResolvedValue(new RawTestResult(false, ['--- FAIL: TestAlpha'], ['TestAlpha']));
    const node = new TestNode('TestAlpha', fileUri);
    await explorer.onRunSingleTest(node);

    await waitFor(() => results.length > 0);

    const alpha = results.find((r) => r.testName === 'TestAlpha');
    expect(alpha.isPassed).toBe(false);
  });

  it('marks the tests as failed when the run throws', async () => {
    runGoTest.mockRejectedValue(new Error('boom'));
    const node = new TestNode('TestAlpha', fileUri);
    await explorer.onRunSingleTest(node);

    await waitFor(() => results.length > 0);

    const alpha = results.find((r) => r.testName === 'TestAlpha');
    expect(alpha.isPassed).toBe(false);
    expect(alpha.output.join('\n')).toContain('boom');
  });

  it('marks a test as failed when one of its subtests failed', async () => {
    // The tool reports the subtest that failed. The test that holds it
    // failed too, so it must not be reported as passed.
    runGoTest.mockResolvedValue(
      new RawTestResult(false, ['--- FAIL: TestAlpha/sub'], ['TestAlpha/sub']),
    );
    const node = new TestNode('TestAlpha', fileUri);
    await explorer.onRunSingleTest(node);

    await waitFor(() => results.length > 0);

    const alpha = results.find((r) => r.testName === 'TestAlpha');
    expect(alpha.isPassed).toBe(false);
  });

  it('does not mark a test as failed when a different test failed', async () => {
    runGoTest.mockResolvedValue(new RawTestResult(false, ['--- FAIL: TestOther'], ['TestOther']));
    const node = new TestNode('TestAlpha', fileUri);
    await explorer.onRunSingleTest(node);

    await waitFor(() => results.length > 0);

    const alpha = results.find((r) => r.testName === 'TestAlpha');
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

describe('GoTestExplorer shows a test as soon as it finishes', () => {
  let explorer: GoTestExplorer;
  let outcomes: TestResult[];
  let results: TestResult[];

  beforeEach(() => {
    __reset();
    runGoTest.mockReset();
    explorer = new GoTestExplorer(fakeContext());
    outcomes = [];
    results = [];
    explorer.commands.testOutcome((r: TestResult) => outcomes.push(r));
    explorer.commands.testResult((r: TestResult) => results.push(r));
  });

  const suite = () =>
    new TestNode('alpha_test.go', fileUri, [
      new TestNode('TestAlpha', fileUri),
      new TestNode('TestBeta', fileUri),
    ]);

  it('reports a test before the run has finished', async () => {
    let seenWhileRunning = 0;
    runGoTest.mockImplementation(async (config) => {
      config.onTestFinished({
        package: 'example.com/pkg',
        name: 'TestAlpha',
        passed: true,
        elapsed: 0,
        output: ['alpha output'],
      });
      seenWhileRunning = outcomes.length;
      return new RawTestResult(true, ['ok'], []);
    });

    await vscode.commands.executeCommand('goTestExplorer.runTestSuite', suite());
    await waitFor(() => results.some((r) => r.testName === 'alpha_test.go'));

    expect(seenWhileRunning).toBe(1);
    expect(outcomes[0].testName).toBe('TestAlpha');
    expect(outcomes[0].isPassed).toBe(true);
    expect(outcomes[0].output).toEqual(['alpha output']);
  });

  it('does not report the test again when the run ends', async () => {
    runGoTest.mockImplementation(async (config) => {
      config.onTestFinished({
        package: 'p',
        name: 'TestAlpha',
        passed: true,
        elapsed: 0,
        output: [],
      });
      return new RawTestResult(true, ['ok'], []);
    });

    await vscode.commands.executeCommand('goTestExplorer.runTestSuite', suite());
    await waitFor(() => results.some((r) => r.testName === 'alpha_test.go'));

    // TestBeta never reported, so the end of the run covers it; TestAlpha
    // keeps the outcome it was shown with.
    expect(results.map((r) => r.testName).sort()).toEqual(['TestBeta', 'alpha_test.go']);
  });

  it('marks the suite as failed when a test that was already shown failed', async () => {
    runGoTest.mockImplementation(async (config) => {
      config.onTestFinished({
        package: 'p',
        name: 'TestAlpha',
        passed: false,
        elapsed: 0,
        output: [],
      });
      return new RawTestResult(false, ['--- FAIL: TestAlpha'], ['TestAlpha']);
    });

    await vscode.commands.executeCommand('goTestExplorer.runTestSuite', suite());
    await waitFor(() => results.some((r) => r.testName === 'alpha_test.go'));

    expect(results.find((r) => r.testName === 'alpha_test.go')?.isPassed).toBe(false);
  });

  it('ignores a subtest and a test that was not asked for', async () => {
    runGoTest.mockImplementation(async (config) => {
      config.onTestFinished({
        package: 'p',
        name: 'TestAlpha/sub',
        passed: true,
        elapsed: 0,
        output: [],
      });
      config.onTestFinished({
        package: 'p',
        name: 'TestOther',
        passed: true,
        elapsed: 0,
        output: [],
      });
      return new RawTestResult(true, ['ok'], []);
    });

    await vscode.commands.executeCommand('goTestExplorer.runTestSuite', suite());
    await waitFor(() => results.some((r) => r.testName === 'alpha_test.go'));

    expect(outcomes).toEqual([]);
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
    return new TestNode(
      name,
      uri,
      tests.map((test) => new TestNode(test, uri)),
    );
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
      'example.com/mod/pkg/b',
    ]);
    expect(config.packages.map((p: { path: string }) => p.path)).toEqual(['pkg/a', 'pkg/b']);
  });

  it('runs only the tests that match the filter when Run All is used', async () => {
    const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha', 'TestBeta']);
    const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestGamma']);
    explorer.commands.sendDiscoveredTests([a, b]);
    explorer.goTestProvider.filter = 'beta';

    await vscode.commands.executeCommand('goTestExplorer.runAllTest');
    await waitFor(() => runGoTest.mock.calls.length > 0);

    expect(runGoTest.mock.calls.length).toBe(1);
    expect(runGoTest.mock.calls[0][0].functions).toEqual(['TestBeta']);
  });

  it('runs only the failed tests when filtered by status', async () => {
    const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha', 'TestBeta']);
    explorer.commands.sendDiscoveredTests([a]);
    explorer.commands.sendTestResult(new TestResult(a.uri, 'TestAlpha', true, []));
    explorer.commands.sendTestResult(new TestResult(a.uri, 'TestBeta', false, []));

    await vscode.commands.executeCommand('goTestExplorer.filterTests');
    const box = __state.quickPicks[__state.quickPicks.length - 1];
    box.tick('failed');
    box.accept();
    expect(explorer.goTestProvider.statuses.has('failed')).toBe(true);

    await vscode.commands.executeCommand('goTestExplorer.runAllTest');
    await waitFor(() => runGoTest.mock.calls.length > 0);
    expect(runGoTest.mock.calls[0][0].functions).toEqual(['TestBeta']);

    await vscode.commands.executeCommand('goTestExplorer.clearFilter');
    expect(explorer.goTestProvider.isFiltered).toBe(false);
  });

  describe('coverage', () => {
    const profile = () =>
      new Map([
        [
          'example.com/mod/pkg/a/a.go',
          [
            { startLine: 1, startCol: 1, endLine: 2, endCol: 2, statements: 1, count: 1 },
            { startLine: 4, startCol: 1, endLine: 5, endCol: 2, statements: 1, count: 0 },
          ],
        ],
      ]);

    function openEditor(fsPath: string) {
      const marks: Array<{ key: string; lines: number[] }> = [];
      __state.visibleTextEditors.push({
        document: { uri: Uri.file(fsPath) },
        selection: undefined as never,
        revealRange: () => {},
        setDecorations: (type: unknown, ranges: Array<{ start: { line: number } }>) =>
          marks.push({
            key: (type as { key: string }).key,
            lines: ranges.map((r) => r.start.line),
          }),
      });
      return marks;
    }

    it('measures nothing until it is turned on, then marks the lines of a run', async () => {
      const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha']);
      explorer.commands.sendDiscoveredTests([a]);
      const marks = openEditor(path.join(moduleDir, 'pkg', 'a', 'a.go'));

      await vscode.commands.executeCommand('goTestExplorer.runTest', a.children[0]);
      await waitFor(() => runGoTest.mock.calls.length > 0);
      expect(runGoTest.mock.calls[0][0].coverage).toBe(false);

      await vscode.commands.executeCommand('goTestExplorer.showCoverage');
      runGoTest.mockResolvedValue(new RawTestResult(true, [], [], undefined, new Map(), profile()));
      await vscode.commands.executeCommand('goTestExplorer.runTest', a.children[0]);
      await waitFor(() => runGoTest.mock.calls.length > 1);
      expect(runGoTest.mock.calls[1][0].coverage).toBe(true);

      await waitFor(() => marks.length > 0);
      expect(marks.slice(-2).map((m) => m.lines)).toEqual([
        [0, 1],
        [3, 4],
      ]);
      expect(__state.statusItems[0].text).toContain('50.0%');
      expect(__state.statusItems[0].visible).toBe(true);
    });

    it('tells the user what to do when coverage is turned on', async () => {
      await vscode.commands.executeCommand('goTestExplorer.showCoverage');

      expect(__state.messages.info.join('\n')).toContain('Run your tests');
      expect(__state.statusItems[0].text).toContain('run tests');
      expect(__state.statusItems[0].visible).toBe(true);
    });

    it('shows the coverage in the header of the view, where it stays in place', async () => {
      const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha']);
      explorer.commands.sendDiscoveredTests([a]);
      const header = () => (explorer as unknown as { treeView: { description?: string } }).treeView;
      await vscode.commands.executeCommand('goTestExplorer.showCoverage');
      expect(header().description).toBe('Coverage: run tests');

      runGoTest.mockResolvedValue(new RawTestResult(true, [], [], undefined, new Map(), profile()));
      await vscode.commands.executeCommand('goTestExplorer.runTest', a.children[0]);
      await waitFor(() => completed.length > 0);
      // One test ran, not every test, so the figure says it is partial.
      expect(header().description).toBe('Coverage 50.0% (partial)');

      // Run All gives the figure of the project.
      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
      await waitFor(() => header().description === 'Coverage 50.0%');

      // A saved file is forgotten, so the figure is partial again.
      __state.saveListeners.forEach((listener) =>
        listener({ uri: Uri.file(path.join(moduleDir, 'pkg', 'a', 'a.go')) }),
      );
      expect(header().description).toBe('Coverage: run tests');
      // The tests are the only rows of the tree, so the header does not scroll away.
      expect(await explorer.goTestProvider.getChildren()).toEqual([a]);

      await vscode.commands.executeCommand('goTestExplorer.hideCoverage');
      expect(header().description).toBeUndefined();
    });

    it('lists the covered files, the least covered first, and opens the one picked', async () => {
      const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha']);
      explorer.commands.sendDiscoveredTests([a]);
      await vscode.commands.executeCommand('goTestExplorer.showCoverage');
      runGoTest.mockResolvedValue(new RawTestResult(true, [], [], undefined, new Map(), profile()));
      await vscode.commands.executeCommand('goTestExplorer.runTest', a.children[0]);
      await waitFor(() => completed.length > 0);

      let offered: Array<{ label: string; description: string }> = [];
      __state.quickPickAnswer = (items) => {
        offered = items as typeof offered;
        return items[0];
      };
      await vscode.commands.executeCommand('goTestExplorer.showCoverageReport');

      expect(offered.length).toBe(1);
      expect(offered[0].label).toContain('50.0%');
      expect(offered[0].description).toBe('1 of 2 statements ran');
      expect(__state.shownDocuments.length).toBe(1);
    });

    it('says so when there is no coverage to list', async () => {
      await vscode.commands.executeCommand('goTestExplorer.showCoverageReport');
      expect(__state.messages.info.join('\n')).toContain('no coverage yet');
    });

    it('removes the marks when it is turned off', async () => {
      const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha']);
      explorer.commands.sendDiscoveredTests([a]);
      const marks = openEditor(path.join(moduleDir, 'pkg', 'a', 'a.go'));
      await vscode.commands.executeCommand('goTestExplorer.showCoverage');
      runGoTest.mockResolvedValue(new RawTestResult(true, [], [], undefined, new Map(), profile()));
      await vscode.commands.executeCommand('goTestExplorer.runTest', a.children[0]);
      await waitFor(() => marks.length > 0);

      await vscode.commands.executeCommand('goTestExplorer.hideCoverage');

      expect(marks.slice(-2).map((m) => m.lines)).toEqual([[], []]);
      expect(__state.statusItems[0].visible).toBe(false);
    });
  });

  it('expands every file that is shown', async () => {
    const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestAlpha']);
    const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestBeta']);
    explorer.commands.sendDiscoveredTests([a, b]);
    explorer.goTestProvider.filter = 'beta';

    await vscode.commands.executeCommand('goTestExplorer.expandAll');

    expect(__state.revealed.map((r) => r.node)).toEqual([b]);
    expect(__state.revealed[0].options).toMatchObject({ expand: true });
  });

  it('collapses every file with the command of the view, and shows the other button', async () => {
    const contexts: unknown[][] = [];
    const collapsed: string[] = [];
    __state.registeredCommands.set('setContext', (...args) => contexts.push(args));
    __state.registeredCommands.set('workbench.actions.treeView.goTestExplorer.collapseAll', () =>
      collapsed.push('collapseAll'),
    );

    await vscode.commands.executeCommand('goTestExplorer.collapseAll');
    expect(collapsed).toEqual(['collapseAll']);
    expect(contexts.pop()).toEqual(['goTestExplorer.allExpanded', false]);

    await vscode.commands.executeCommand('goTestExplorer.expandAll');
    expect(contexts.pop()).toEqual(['goTestExplorer.allExpanded', true]);
  });

  describe('the filter box', () => {
    const openBox = async () => {
      await vscode.commands.executeCommand('goTestExplorer.filterTests');
      return __state.quickPicks[__state.quickPicks.length - 1];
    };

    it('narrows the tree while the text is typed, and keeps it on Enter', async () => {
      const box = await openBox();
      box.type('be');
      expect(explorer.goTestProvider.filter).toBe('be');
      box.type('beta');
      expect(explorer.goTestProvider.filter).toBe('beta');
      box.accept();
      expect(explorer.goTestProvider.filter).toBe('beta');
    });

    it('puts back the previous filter on Escape', async () => {
      explorer.goTestProvider.filter = 'alpha';
      explorer.goTestProvider.statuses = ['passed'];
      const box = await openBox();
      box.type('gamma');
      box.tick('failed');
      box.cancel();
      expect(explorer.goTestProvider.filter).toBe('alpha');
      expect(Array.from(explorer.goTestProvider.statuses)).toEqual(['passed']);
    });

    it('applies the text and the statuses together, and shows the statuses whatever is typed', async () => {
      const box = await openBox();
      expect(box.items.every((item) => (item as { alwaysShow: boolean }).alwaysShow)).toBe(true);
      box.type('beta');
      box.tick('failed', 'notRun');
      expect(explorer.goTestProvider.filter).toBe('beta');
      expect(Array.from(explorer.goTestProvider.statuses)).toEqual(['failed', 'notRun']);
    });
  });

  it('matches a finished test to its own package', async () => {
    const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestSame']);
    const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestSame']);
    explorer.commands.sendDiscoveredTests([a, b]);
    const outcomes: TestResult[] = [];
    explorer.commands.testOutcome((r: TestResult) => outcomes.push(r));
    runGoTest.mockImplementation(async (config) => {
      config.onTestFinished({
        package: 'example.com/mod/pkg/b',
        name: 'TestSame',
        passed: false,
        elapsed: 0,
        output: [],
      });
      return new RawTestResult(false, [], ['TestSame']);
    });

    await vscode.commands.executeCommand('goTestExplorer.runAllTest');
    await waitFor(() => completed.length > 0);

    expect(outcomes.length).toBe(1);
    expect(outcomes[0].uri.fsPath).toBe(b.uri.fsPath);
  });

  describe('a module with more packages than one run takes', () => {
    const importPathOf = (name: string) => `example.com/mod/pkg/${name}`;

    const fivePackages = () =>
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        suiteIn(path.join(moduleDir, 'pkg', name), `${name}_test.go`, [
          `Test${name.toUpperCase()}`,
        ]),
      );

    const passedPackage = (name: string): PackageResult => ({
      package: importPathOf(name),
      tests: new Map(),
      failedTests: [],
      output: [],
      failed: false,
      buildFailed: false,
    });

    const passed = (names: string[]) =>
      new RawTestResult(
        true,
        [],
        [],
        undefined,
        new Map(names.map((name) => [importPathOf(name), passedPackage(name)] as const)),
      );

    beforeEach(() => {
      __setConfiguration('goTestExplorer', { maxPackagesPerRun: 2 });
    });

    it('runs it in runs that follow one another, not together', async () => {
      explorer.commands.sendDiscoveredTests(fivePackages());
      let active = 0;
      let mostActive = 0;
      runGoTest.mockImplementation(async (config) => {
        active++;
        mostActive = Math.max(mostActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return passed(config.packages.map((p: { path: string }) => p.path.split('/').pop()));
      });

      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
      await waitFor(() => completed.length > 0);

      expect(runGoTest.mock.calls.map((call) => call[0].packages.length)).toEqual([2, 2, 1]);
      expect(mostActive).toBe(1);
    });

    it('covers every package once', async () => {
      explorer.commands.sendDiscoveredTests(fivePackages());
      runGoTest.mockImplementation(async (config) =>
        passed(config.packages.map((p: { path: string }) => p.path.split('/').pop())),
      );

      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
      await waitFor(() => completed.length > 0);

      const run = runGoTest.mock.calls.flatMap((call) =>
        call[0].packages.map((p: { importPath: string }) => p.importPath),
      );
      expect(run.sort()).toEqual(['a', 'b', 'c', 'd', 'e'].map(importPathOf));
    });

    it('reads the outcome of a package from the run that tested it', async () => {
      explorer.commands.sendDiscoveredTests(fivePackages());
      runGoTest.mockImplementation(async (config) => {
        const names = config.packages.map((p: { path: string }) => p.path.split('/').pop());
        const result = passed(names);
        if (names.includes('c')) {
          // The run that holds package c failed in c only.
          const failing = result.packages.get(importPathOf('c'));
          result.packages = new Map(result.packages).set(importPathOf('c'), {
            ...failing,
            failed: true,
            failedTests: ['TestC'],
          } as never);
          return new RawTestResult(false, [], ['TestC'], undefined, result.packages);
        }
        return result;
      });

      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
      await waitFor(() => completed.length > 0);

      const failed = results.filter((r) => !r.isPassed).map((r) => r.testName);
      expect(failed.sort()).toEqual(['TestC', 'c_test.go']);
    });

    it('does not start the runs that are left when the user cancels', async () => {
      explorer.commands.sendDiscoveredTests(fivePackages());
      runGoTest.mockImplementation(async () => {
        // The user cancels while the first run is going.
        await vscode.commands.executeCommand('goTestExplorer.cancelTestRun');
        return new RawTestResult(false, [], []);
      });

      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
      await waitFor(() => completed.length > 0);

      expect(runGoTest.mock.calls.length).toBe(1);
      // Nothing was tested for the rest, so none of it passed.
      expect(results.every((r) => !r.isPassed)).toBe(true);
    });

    it('does not split a module when the setting is zero and it fits', async () => {
      __setConfiguration('goTestExplorer', { maxPackagesPerRun: 0 });
      explorer.commands.sendDiscoveredTests(fivePackages());
      runGoTest.mockResolvedValue(new RawTestResult(true, [], []));

      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
      await waitFor(() => completed.length > 0);

      expect(runGoTest.mock.calls.length).toBe(1);
    });
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
    expect(config.packages[0].files.map((f: { name: string }) => f.name)).toEqual([
      'a_test.go',
      'b_test.go',
    ]);
  });

  it('attributes the outcome of a test to the package it belongs to', async () => {
    const packages = new Map<string, PackageResult>();
    packages.set('example.com/mod/pkg/a', {
      package: 'example.com/mod/pkg/a',
      tests: new Map(),
      failedTests: ['TestA'],
      output: ['a output'],
      failed: true,
      buildFailed: false,
    });
    packages.set('example.com/mod/pkg/b', {
      package: 'example.com/mod/pkg/b',
      tests: new Map(),
      failedTests: [],
      output: ['b output'],
      failed: false,
      buildFailed: false,
    });
    runGoTest.mockResolvedValue(new RawTestResult(false, [], ['TestA'], undefined, packages));

    const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestA']);
    const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestB']);
    explorer.commands.sendDiscoveredTests([a, b]);

    await vscode.commands.executeCommand('goTestExplorer.runAllTest');
    await waitFor(() => results.length > 0);

    expect(results.find((r) => r.testName === 'TestA')?.isPassed).toBe(false);
    expect(results.find((r) => r.testName === 'TestB')?.isPassed).toBe(true);
    expect(results.find((r) => r.testName === 'TestA')?.output).toEqual(['a output']);
    expect(results.find((r) => r.testName === 'TestB')?.output).toEqual(['b output']);
  });

  it('reports the outcome of every file of the run', async () => {
    const a = suiteIn(path.join(moduleDir, 'pkg', 'a'), 'a_test.go', ['TestA']);
    const b = suiteIn(path.join(moduleDir, 'pkg', 'b'), 'b_test.go', ['TestB']);
    explorer.commands.sendDiscoveredTests([a, b]);

    await vscode.commands.executeCommand('goTestExplorer.runAllTest');
    await waitFor(() => completed.length > 0);

    expect(completed.length).toBe(1);
    expect(completed[0].map((uri) => path.basename(uri.fsPath))).toEqual([
      'a_test.go',
      'b_test.go',
    ]);
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
  let editor: {
    document: { uri: vscode.Uri };
    selection: vscode.Selection;
    revealRange: (r: vscode.Range) => void;
  };

  beforeEach(() => {
    __reset();
    explorer = new GoTestExplorer(fakeContext());
    editor = {
      document: { uri: fileUri },
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      revealRange: vi.fn(),
    };
    __state.activeTextEditor = editor as never;
  });

  it('selects the name of the test in the open document', async () => {
    __setDocumentText(
      fileUri.fsPath,
      ['package pkg', '', 'func TestAlpha(t *testing.T) {', '\tt.Log("hello")', '}'].join('\n'),
    );

    await explorer.go(new TestNode('TestAlpha', fileUri));

    expect(editor.selection.start.line).toBe(2);
    expect(editor.selection.start.character).toBe(5);
    expect(editor.selection.end.character).toBe(14);
  });

  it('finds a test in an unsaved edit', async () => {
    // The document on disk still has the old name; the buffer has the new
    // one. Go-to-location must follow the buffer.
    __setDocumentText(
      fileUri.fsPath,
      ['package pkg', '', 'func TestRenamed(t *testing.T) {}'].join('\n'),
    );

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
    await new Promise((r) => setTimeout(r, 5));
  }
}
