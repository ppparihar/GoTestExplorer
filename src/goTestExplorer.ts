import * as vscode from 'vscode';
import * as path from 'path';
import { GoTestProvider } from './goTestProvider';
import { runGoTest, TestConfig, TestPackage, cancelRunningTests } from './lib/testUtil';
import { TestNode } from './testNode';
import { CoverageDecorations } from './coverageDecorations';
import { CoverBlock, CoverProfile } from './lib/coverageProfile';
import { TestStatus } from './lib/testFilter';
import { Commands } from './commands';
import { TestResult } from './testResult';
import { RawTestResult } from './rawTestResult';
import { TestDiscovery } from './testDiscovery';
import { TestQueue } from './runner/testQueue';
import { scanGoSource } from './discovery/goScanner';
import { FinishedTest, hasFailed, PackageResult } from './exec/goTestJsonParser';
import { findGoModule, GoModule, importPathOf } from './lib/goModule';
import { testOutput } from './lib/testOutput';
import { maxPackagesPerRun, maxParallelTests, runSettings } from './lib/settings';
import { argumentBudget, chunkPackages, mergeResults } from './runner/chunkPackages';

/**
 * The files of one module, and the packages they belong to.
 */
interface ModuleGroup {
  /**
   * The module the files belong to.
   */
  module: GoModule;
  /**
   * The packages of the module that hold tests.
   */
  packages: TestPackage[];
  /**
   * The files that hold tests.
   */
  suites: TestNode[];
}

const STATUS_LABELS: Record<TestStatus, string> = {
  failed: 'failed',
  passed: 'passed',
  notRun: 'not run',
};

export class GoTestExplorer {
  goTestProvider: GoTestProvider;
  private readonly treeView: vscode.TreeView<TestNode>;
  private readonly coverage: CoverageDecorations;
  /**
   * Whether the runs measure what the tests cover.
   */
  private coverageEnabled = false;
  private filterMessage: string | undefined;

  readonly commands: Commands;
  private readonly testQueue: TestQueue;
  /**
   * The tests of each run whose outcome was already shown while the run was
   * going, so that the end of the run does not draw them again.
   */
  private readonly reported = new WeakMap<TestConfig, Set<string>>();
  /**
   * Counts the cancellations. A run that was split into several runs stops
   * starting the next one when the count has changed since it began.
   */
  private cancellations = 0;

  constructor(context: vscode.ExtensionContext) {
    this.commands = new Commands();
    this.goTestProvider = new GoTestProvider(context, this.commands);
    const testDiscoverer = new TestDiscovery(this.commands, context);
    this.testQueue = new TestQueue(
      (testConfig) => this.runInChunks(testConfig),
      // The limit is read for every run, so a change to the setting
      // takes effect without reloading the window.
      () => maxParallelTests(),
      (testConfig, result) => this.onRunCompleted(testConfig, result),
      (testConfig, error) => this.onRunFailed(testConfig, error),
    );
    this.treeView = vscode.window.createTreeView('goTestExplorer', {
      treeDataProvider: this.goTestProvider,
    });
    context.subscriptions.push(this.treeView);
    this.coverage = new CoverageDecorations();
    context.subscriptions.push(this.coverage);

    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.runTest', this.onRunSingleTest.bind(this)),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.runAllTest', this.onRunAllTests.bind(this)),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.refreshTestExplorer', () => {
        testDiscoverer.discoverAllTests();
      }),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'goTestExplorer.showCoverage',
        this.onShowCoverage.bind(this),
      ),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'goTestExplorer.showCoverageReport',
        this.onShowCoverageReport.bind(this),
      ),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.hideCoverage', () => this.setCoverage(false)),
    );
    this.setCoverage(false);
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.expandAll', this.onExpandAll.bind(this)),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.collapseAll', this.onCollapseAll.bind(this)),
    );
    this.showExpanded(true);
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.filterTests', this.onFilterTests.bind(this)),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.clearFilter', () => {
        this.goTestProvider.statuses = [];
        this.setFilter('');
      }),
    );
    const cancelTestRun = () => {
      // The invocations that have not started are dropped, and the ones
      // that are running are killed.
      this.cancellations++;
      this.testQueue.cancel();
      const stopped = cancelRunningTests();
      if (stopped === 0) {
        vscode.window.showInformationMessage('No test run is in progress.');
      }
    };
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.cancelTestRun', cancelTestRun),
    );
    // Ctrl+C in the terminal of the output stops the runs, the way it
    // stops a command in any other terminal.
    testOutput.setCancelHandler(cancelTestRun);
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.showTestoutput', (testNode: TestNode) => {
        const output =
          testNode.testResult && testNode.testResult.output && testNode.testResult.output.length > 0
            ? testNode.testResult.output.join('\n')
            : 'No output';
        vscode.window.showInformationMessage(output);
      }),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.goToLocation', this.go.bind(this)),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('goTestExplorer.runTestSuite', this.runTestSuite.bind(this)),
    );
    testDiscoverer.discoverAllTests();
  }
  /**
   * Turns the measuring of coverage on or off.
   *
   * While it is on, every run measures what the tests cover, and the lines
   * are marked in the editors when the run ends. Turning it off removes the
   * marks.
   */
  private setCoverage(enabled: boolean) {
    this.coverageEnabled = enabled;
    if (!enabled) {
      this.coverage.clear();
    }
    this.coverage.setEnabled(enabled);
    this.updateMessage();
    this.showCoverageSummary();
    vscode.commands.executeCommand('setContext', 'goTestExplorer.coverageEnabled', enabled);
  }

  /**
   * Puts what the tests covered above the list of tests.
   */
  private showCoverageSummary() {
    if (!this.coverageEnabled) {
      this.goTestProvider.fileCoverage = new Map();
      this.goTestProvider.coverageSummary = undefined;
      return;
    }
    this.goTestProvider.fileCoverage = this.coverageOfTestFiles();
    const percent = this.coverage.percent;
    const files = this.coverage.report().length;
    this.goTestProvider.coverageSummary =
      percent === undefined
        ? 'Coverage: run tests to see it'
        : `Coverage ${percent.toFixed(1)}% (${files} ${files === 1 ? 'file' : 'files'})`;
  }

  /**
   * What the tests covered for each test file, to be shown beside it.
   *
   * The coverage of a test file is the coverage of the file it tests, by the
   * naming of Go (`a_test.go` tests `a.go`). A test file without such a file
   * shows the coverage of its package.
   */
  private coverageOfTestFiles(): Map<string, string> {
    const shown = new Map<string, string>();
    this.goTestProvider.discoveredTests.forEach((suite) => {
      const testFile = suite.uri.fsPath;
      const own = this.coverage.percentOfFile(testFile.replace(/_test\.go$/, '.go'));
      if (own !== undefined) {
        shown.set(testFile, `${own.toFixed(1)}%`);
        return;
      }
      const wholePackage = this.coverage.percentOfDirectory(path.dirname(testFile));
      if (wholePackage !== undefined) {
        shown.set(testFile, `package ${wholePackage.toFixed(1)}%`);
      }
    });
    return shown;
  }

  /**
   * Turns coverage on, and says what happens next: coverage is measured by the
   * runs that start from now on, so the user is offered a run at once.
   */
  private async onShowCoverage() {
    this.setCoverage(true);
    const runAll = 'Run All Tests';
    const choice = await vscode.window.showInformationMessage(
      'Code coverage is on. Run your tests from this view to see which lines they ran (green) and which they did not (red).',
      runAll,
    );
    if (choice === runAll) {
      await vscode.commands.executeCommand('goTestExplorer.runAllTest');
    }
  }

  /**
   * Lists the files that were covered, the least covered first, and opens the
   * one that is picked.
   */
  private async onShowCoverageReport() {
    const report = this.coverage.report();
    if (report.length === 0) {
      vscode.window.showInformationMessage(
        'There is no coverage yet. Run tests from the Go Test Explorer with coverage on.',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      report.map((entry) => ({
        label: `${entry.percent.toFixed(1)}%  ${vscode.workspace.asRelativePath(entry.file)}`,
        description: `${entry.ran} of ${entry.total} statements ran`,
        file: entry.file,
      })),
      { title: 'Code coverage by file', placeHolder: 'Pick a file to open it' },
    );
    if (picked) {
      await vscode.window.showTextDocument(vscode.Uri.file(picked.file));
    }
  }

  /**
   * Marks the lines a finished run covered.
   *
   * The profile names a file by its import path, so the module of the run
   * turns that name into the path of the file.
   */
  private showCoverage(testConfig: TestConfig, profile: CoverProfile | undefined) {
    if (!profile || !this.coverageEnabled) {
      return;
    }
    const module = findGoModule(testConfig.dir);
    if (!module) {
      return;
    }
    const prefix = module.path + '/';
    const files = new Map<string, CoverBlock[]>();
    profile.forEach((blocks, name) => {
      if (name.startsWith(prefix)) {
        files.set(path.join(module.root, ...name.slice(prefix.length).split('/')), blocks);
      }
    });
    this.coverage.update(files);
    this.showCoverageSummary();
  }

  /**
   * Expands every file that is shown.
   *
   * The view has one button for expanding and collapsing: this is the one it
   * shows while the files are collapsed.
   */
  private async onExpandAll() {
    this.showExpanded(true);
    for (const suite of this.goTestProvider.visibleTests.filter((s) => s.isTestSuite)) {
      await this.treeView.reveal(suite, { expand: true, select: false, focus: false });
    }
  }

  /**
   * Collapses every file, with the command the view itself has for it.
   */
  private async onCollapseAll() {
    this.showExpanded(false);
    await vscode.commands.executeCommand('workbench.actions.treeView.goTestExplorer.collapseAll');
  }

  /**
   * Tells the title of the view which of the two buttons to show.
   */
  private showExpanded(expanded: boolean) {
    vscode.commands.executeCommand('setContext', 'goTestExplorer.allExpanded', expanded);
  }

  /**
   * One box for the whole filter: the text is typed in it, and the statuses
   * are ticked in its list.
   *
   * The tree follows the box as it changes. Enter keeps the filter, and
   * Escape puts back the one that was on before.
   */
  private onFilterTests() {
    const provider = this.goTestProvider;
    const previousText = provider.filter;
    const previousStatuses = Array.from(provider.statuses);

    const choices: Array<vscode.QuickPickItem & { status: TestStatus }> = [
      { label: '$(error) Failed', status: 'failed' },
      { label: '$(pass) Passed', status: 'passed' },
      { label: '$(circle-outline) Not run', status: 'notRun' },
    ];
    // The statuses stay in the list whatever is typed: the built-in matching
    // of the box would otherwise hide them.
    choices.forEach((choice) => (choice.alwaysShow = true));

    const box = vscode.window.createQuickPick<(typeof choices)[number]>();
    let accepted = false;
    box.title = 'Filter tests';
    box.placeholder = 'Type words of a test or file name, and tick the statuses to show';
    box.canSelectMany = true;
    box.items = choices;
    box.selectedItems = choices.filter((choice) => provider.statuses.has(choice.status));
    box.value = previousText;
    box.onDidChangeValue((text) => this.setFilter(text));
    box.onDidChangeSelection((picked) => {
      provider.statuses = picked.map((choice) => choice.status);
      this.showFilter();
    });
    box.onDidAccept(() => {
      accepted = true;
      box.hide();
    });
    box.onDidHide(() => {
      if (!accepted) {
        provider.statuses = previousStatuses;
        this.setFilter(previousText);
      }
      box.dispose();
    });
    box.show();
  }

  private setFilter(text: string) {
    this.goTestProvider.filter = text;
    this.showFilter();
  }

  /**
   * Shows what the filter and the coverage are doing above the tests, so that
   * the state of the view can be read without guessing from its buttons.
   */
  private updateMessage() {
    const lines = [this.filterMessage];
    if (this.coverageEnabled) {
      lines.push(
        'Coverage is on: run tests here and the lines they ran are marked green, the lines they did not red.',
      );
    }
    const text = lines.filter(Boolean).join('\n');
    this.treeView.message = text || undefined;
  }

  /**
   * Tells the view, and the buttons of its title, what the tree is narrowed to.
   */
  private showFilter() {
    const provider = this.goTestProvider;
    const parts: string[] = [];
    if (provider.filter) {
      parts.push(`"${provider.filter}"`);
    }
    if (provider.statuses.size > 0) {
      parts.push(Array.from(provider.statuses, (status) => STATUS_LABELS[status]).join(' or '));
    }
    this.filterMessage = provider.isFiltered
      ? `Filter: ${parts.join(', ')}. Run All runs only the matching tests.`
      : undefined;
    this.updateMessage();
    vscode.commands.executeCommand(
      'setContext',
      'goTestExplorer.filterActive',
      provider.isFiltered,
    );
  }

  async onRunSingleTest(testNode: TestNode) {
    this.commands.sendTestRunStarted([testNode]);
    const testConfig = this.buildTestConfig(testNode);
    this.enqueueTest(testConfig);
  }
  private runTestSuite(testNode: TestNode) {
    // A filter narrows the suite to the tests that are shown.
    const children = this.goTestProvider.visibleChildrenOf(testNode);
    if (children.length === 0) {
      return;
    }
    // Every test of the suite is reported in one event, so the tree is
    // redrawn once for the whole suite.
    this.commands.sendTestRunStarted([...children, testNode]);
    const testConfig = this.buildTestConfig(testNode, children);
    this.enqueueTest(testConfig);
  }

  /**
   * Runs every test of the workspace.
   *
   * The files are grouped by the module they belong to, and one run tests
   * all the packages of a module at once: the packages are compiled once,
   * and the tool decides how to spread them over the available cores.
   */
  private onRunAllTests() {
    if (this.goTestProvider.isFiltered) {
      // A run of a module has no filter on the names of its tests, so only
      // the files that are shown are run, each with the tests that are shown.
      this.goTestProvider.visibleTests
        .filter((s) => s.isTestSuite)
        .forEach((suite) => this.runTestSuite(suite));
      return;
    }
    const suites = this.goTestProvider.discoveredTests.filter((s) => s.isTestSuite);
    const groups = new Map<string, ModuleGroup>();
    const withoutModule: TestNode[] = [];

    // The files of one directory belong to one package.
    const byDirectory = new Map<string, TestNode[]>();
    suites.forEach((suite) => {
      const dir = path.dirname(suite.uri.fsPath);
      const files = byDirectory.get(dir) || [];
      files.push(suite);
      byDirectory.set(dir, files);
    });

    byDirectory.forEach((files, dir) => {
      const module = findGoModule(dir);
      if (!module) {
        // A directory that is not in a module is run the way it was
        // before: one run for each file.
        withoutModule.push(...files);
        return;
      }
      let group = groups.get(module.root);
      if (!group) {
        group = { module, packages: [], suites: [] };
        groups.set(module.root, group);
      }
      group.packages.push({
        importPath: importPathOf(module, dir),
        path: path.relative(module.root, dir).split(path.sep).join('/'),
        files: files.map((file) => ({
          uri: file.uri,
          name: file.name,
          functions: file.children.map((child) => child.name),
        })),
      });
      group.suites.push(...files);
    });

    withoutModule.forEach((suite) => this.runTestSuite(suite));
    groups.forEach((group) => this.runModule(group));
  }

  /**
   * Runs every test of a module in one process.
   */
  private runModule(group: ModuleGroup) {
    // Every test of the module is reported in one event, so the tree is
    // redrawn once for the whole module.
    const nodes: TestNode[] = [];
    group.suites.forEach((suite) => nodes.push(...suite.children, suite));
    this.commands.sendTestRunStarted(nodes);

    const testConfig: TestConfig = {
      dir: group.module.root,
      settings: runSettings(group.suites[0].uri),
      flags: [],
      functions: group.suites.reduce(
        (all, suite) => all.concat(suite.children.map((child) => child.name)),
        [] as string[],
      ),
      testUri: group.suites[0].uri,
      testName: group.suites[0].name,
      packages: group.packages,
      coverage: this.coverageEnabled,
    };
    this.enqueueTest(testConfig);
  }

  private buildTestConfig(testNode: TestNode, children = testNode.children): TestConfig {
    let tests = children.map((node) => node.name);
    tests = tests.length > 0 ? tests : [testNode.name];
    const testConfig: TestConfig = {
      dir: path.dirname(testNode.uri.fsPath),
      settings: runSettings(testNode.uri),
      flags: [],
      functions: tests,
      testUri: testNode.uri,
      testName: path.basename(testNode.uri.fsPath),
      coverage: this.coverageEnabled,
    };
    return testConfig;
  }

  /**
   * Runs a module in as few runs as the system allows.
   *
   * The packages are tested in one process, which compiles them once and
   * lets the tool spread them over the cores. A module with so many packages
   * that their names would not fit a command line is split into runs that
   * follow one another: they are not started together, because the tool already
   * uses the cores, and more processes would only compete for them.
   *
   * The outcome of each test is shown as its run reports it, and the result of
   * the module is read from the runs together. A cancel stops the run that is
   * going and the ones that have not started.
   */
  private async runInChunks(testConfig: TestConfig): Promise<RawTestResult> {
    const packages = testConfig.packages;
    if (!packages || packages.length < 2) {
      return runGoTest(testConfig);
    }
    const chunks = chunkPackages(packages, {
      maxPackages: maxPackagesPerRun(testConfig.testUri),
      maxArgChars: argumentBudget(),
    });
    if (chunks.length <= 1) {
      return runGoTest(testConfig);
    }

    const cancellations = this.cancellations;
    const results: RawTestResult[] = [];
    for (const chunk of chunks) {
      if (cancellations !== this.cancellations) {
        // Nothing was started for the packages that are left, so the module
        // did not pass.
        results.push(new RawTestResult(false, [], [], new Error('The test run was cancelled.')));
        break;
      }
      results.push(await runGoTest({ ...testConfig, packages: chunk }));
    }
    return mergeResults(results);
  }

  private enqueueTest(testConfig: TestConfig) {
    this.watchTests(testConfig);
    this.testQueue.enqueue(testConfig);
  }

  /**
   * Shows the outcome of each test as soon as the tool reports it, instead of
   * when the whole run has finished.
   *
   * A run of one package names the tests it asked for, so the test is found by
   * its name. A run of several packages is matched on the package as well,
   * because two packages may hold a test with the same name.
   */
  private watchTests(testConfig: TestConfig) {
    const reported = new Set<string>();
    this.reported.set(testConfig, reported);

    const owners = new Map<string, { uri: vscode.Uri; name: string }>();
    if (testConfig.packages && testConfig.packages.length > 0) {
      testConfig.packages.forEach((pkg) =>
        pkg.files.forEach((file) =>
          file.functions.forEach((name) =>
            owners.set(pkg.importPath + '\0' + name, { uri: file.uri, name }),
          ),
        ),
      );
    } else {
      (testConfig.functions || []).forEach((name) =>
        owners.set(name, { uri: testConfig.testUri, name }),
      );
    }
    const multiPackage = !!testConfig.packages && testConfig.packages.length > 0;

    testConfig.onTestFinished = (test: FinishedTest) => {
      const owner = owners.get(multiPackage ? test.package + '\0' + test.name : test.name);
      if (!owner) {
        // A subtest, or a test that was not asked for.
        return;
      }
      reported.add(owner.uri.fsPath + '\0' + owner.name);
      this.commands.sendTestOutcome(
        new TestResult(owner.uri, owner.name, test.passed, test.output.slice()),
      );
    };
  }

  /**
   * Whether the outcome of a test was already shown while its run was going.
   */
  private wasReported(testConfig: TestConfig, uri: vscode.Uri, name: string): boolean {
    return !!this.reported.get(testConfig)?.has(uri.fsPath + '\0' + name);
  }

  /**
   * A test invocation finished. Attribute the outcome to each test that was
   * requested and report the suite-level result.
   */
  private onRunCompleted(testConfig: TestConfig, result: RawTestResult) {
    this.showCoverage(testConfig, result.coverage);
    if (testConfig.packages && testConfig.packages.length > 0) {
      this.onModuleRunCompleted(testConfig, result);
      return;
    }
    let isTestSuitePassed = true;
    testConfig.functions.forEach((t) => {
      let isTestPassed = true;
      // A test fails when it or one of its subtests failed, so a
      // failure in `TestAlpha/sub` marks `TestAlpha` as failed.
      if (
        result.isPassed === false &&
        (!result.failedTests || result.failedTests.length === 0 || hasFailed(result.failedTests, t))
      ) {
        isTestPassed = false;
        isTestSuitePassed = false;
      }
      if (!this.wasReported(testConfig, testConfig.testUri, t)) {
        this.commands.sendTestResult(
          new TestResult(testConfig.testUri, t, isTestPassed, result.output, result.err),
        );
      }
    });

    this.commands.sendTestResult(
      new TestResult(
        testConfig.testUri,
        testConfig.testName,
        isTestSuitePassed,
        result.output,
        result.err,
      ),
    );
    this.commands.sendTestCompleted([testConfig.testUri]);
  }

  /**
   * A run that tested several packages has finished.
   *
   * The outcome of a test is read from the package it belongs to, so that a
   * failure in one package does not mark the tests of another one as failed.
   */
  private onModuleRunCompleted(testConfig: TestConfig, result: RawTestResult) {
    const uris: vscode.Uri[] = [];

    testConfig.packages!.forEach((pkg) => {
      const packageResult = result.packages.get(pkg.importPath);
      const failed = packageResult ? packageResult.failed : !result.isPassed;
      const failedTests = packageResult ? packageResult.failedTests : result.failedTests;
      const output = packageResult ? this.outputOfPackage(packageResult, result) : result.output;

      pkg.files.forEach((file) => {
        uris.push(file.uri);
        let isFilePassed = true;
        file.functions.forEach((t) => {
          let isTestPassed = true;
          // A test fails when it or one of its subtests failed, so a
          // failure in `TestAlpha/sub` marks `TestAlpha` as failed.
          if (failed && (failedTests.length === 0 || hasFailed(failedTests, t))) {
            isTestPassed = false;
            isFilePassed = false;
          }
          if (!this.wasReported(testConfig, file.uri, t)) {
            this.commands.sendTestResult(
              new TestResult(file.uri, t, isTestPassed, output, result.err),
            );
          }
        });
        this.commands.sendTestResult(
          new TestResult(file.uri, file.name, isFilePassed, output, result.err),
        );
      });
    });

    this.commands.sendTestCompleted(uris);
  }

  /**
   * The output of a package.
   *
   * A package that did not build has no output of its own, so the output of
   * the run is used, which holds the build error.
   */
  private outputOfPackage(packageResult: PackageResult, result: RawTestResult): string[] {
    return packageResult.buildFailed ? result.output : packageResult.output.slice();
  }

  /**
   * A test invocation failed outright. Report the whole suite as failed
   * rather than leaving it spinning forever.
   */
  private onRunFailed(testConfig: TestConfig, error: Error) {
    const output = [error.message];
    if (testConfig.packages && testConfig.packages.length > 0) {
      const uris: vscode.Uri[] = [];
      testConfig.packages!.forEach((pkg) => {
        pkg.files.forEach((file) => {
          uris.push(file.uri);
          file.functions.forEach((t) => {
            this.commands.sendTestResult(new TestResult(file.uri, t, false, output, error));
          });
          this.commands.sendTestResult(new TestResult(file.uri, file.name, false, output, error));
        });
      });
      this.commands.sendTestCompleted(uris);
      return;
    }
    testConfig.functions.forEach((t) => {
      this.commands.sendTestResult(new TestResult(testConfig.testUri, t, false, output, error));
    });
    this.commands.sendTestResult(
      new TestResult(testConfig.testUri, testConfig.testName, false, output, error),
    );
    this.commands.sendTestCompleted([testConfig.testUri]);
  }

  /**
   * Opens the file that declares a test and selects its name.
   *
   * The open document is read rather than the file on disk, so a test that
   * has been edited but not saved is still found where the user expects it.
   */
  public async go(testNode: TestNode): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(testNode.uri);
      const scan = scanGoSource(document.getText());
      const declaration = scan.declarations.find((d) => d.name === testNode.name);

      if (!declaration) {
        throw new Error('Could not find test (no symbols matching)');
      }

      await vscode.window.showTextDocument(document);
      const selection = new vscode.Selection(
        new vscode.Position(declaration.line, declaration.startChar),
        new vscode.Position(declaration.line, declaration.endChar),
      );
      vscode.window.activeTextEditor.selection = selection;
      vscode.window.activeTextEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
    } catch (r) {
      vscode.window.showWarningMessage(r instanceof Error ? r.message : String(r));
    }
  }
}
