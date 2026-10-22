import * as vscode from 'vscode';
import * as path from 'path';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';
import { Config } from './config';
import { isActive, TestFilter, TestStatus, visibleChildren, visibleSuites } from './lib/testFilter';

export class GoTestProvider implements vscode.TreeDataProvider<TestNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TestNode | undefined> = new vscode.EventEmitter<
    TestNode | undefined
  >();
  readonly onDidChangeTreeData: vscode.Event<TestNode | undefined> =
    this._onDidChangeTreeData.event;

  private __discoveredTestsMap: Map<string, TestNode> = new Map();
  private _discoveredTests: TestNode[] = [];
  private _discovering: boolean;
  private _filter = '';
  private _statuses: ReadonlySet<TestStatus> = new Set();
  /**
   * The nodes whose result changed since the tree was last redrawn.
   */
  private readonly _pendingResults: Set<TestNode> = new Set();
  /**
   * The nodes that hold a result which finished while a run is going and has
   * not been drawn yet. They are redrawn together, so a run of many fast tests
   * does not redraw the tree once per test.
   */
  private readonly _pendingOutcomes: Set<TestNode> = new Set();
  private _outcomeTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private context: vscode.ExtensionContext,
    commands: Commands,
  ) {
    context.subscriptions.push(commands.discoveredTest(this.onDicoveredTest, this));
    context.subscriptions.push(commands.testDiscoveryStarted(this.onDiscoverTestStart, this));
    context.subscriptions.push(commands.testResult(this.updateTestResult, this));
    context.subscriptions.push(commands.testOutcome(this.onTestOutcome, this));
    context.subscriptions.push(commands.testRunStarted(this.onTestRunStarted, this));
    context.subscriptions.push(commands.testCompleted(this.onTestRunCompleted, this));
    context.subscriptions.push(commands.testFileChanged(this.onTestFileChanged, this));
    context.subscriptions.push(commands.testFileRemoved(this.onTestFileRemoved, this));
    context.subscriptions.push({ dispose: () => this.cancelPendingOutcomes() });
  }

  private refresh(testNode?: TestNode): void {
    this._pendingResults.clear();
    if (this._statuses.size > 0) {
      // A result can move a test in or out of what is shown, and a file in
      // or out of the tree, so the whole tree is drawn.
      testNode = undefined;
    }
    if (!testNode) {
      // The whole tree is drawn, so there is nothing left to draw later.
      this.cancelPendingOutcomes();
    }
    this._onDidChangeTreeData.fire(testNode);
  }

  /**
   * Forgets the results that were waiting to be drawn.
   */
  private cancelPendingOutcomes(): void {
    if (this._outcomeTimer !== undefined) {
      clearTimeout(this._outcomeTimer);
      this._outcomeTimer = undefined;
    }
    this._pendingOutcomes.clear();
  }

  /**
   * Draws the results that finished since the last draw.
   *
   * The suites that changed are redrawn one by one, which keeps the redraw
   * small. A batch that touched many suites redraws the whole tree once.
   */
  private flushOutcomes(): void {
    const nodes = Array.from(this._pendingOutcomes);
    this.cancelPendingOutcomes();
    if (nodes.length === 0) {
      return;
    }
    if (nodes.length > Config.OutcomeRedrawMaxSuites) {
      this.refresh();
      return;
    }
    nodes.forEach((node) => this.refresh(node));
  }

  getTreeItem(testNode: TestNode): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      testNode.name,
      testNode.isTestSuite
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    treeItem.contextValue = this._discovering
      ? 'discovering'
      : testNode.isTestSuite
        ? 'testSuite'
        : 'test';

    if (!testNode.isTestSuite) {
      treeItem.command = {
        command: 'goTestExplorer.goToLocation',
        title: testNode.tooltip,
        arguments: [testNode],
      };
    }
    treeItem.iconPath = {
      dark: this.context.asAbsolutePath(path.join('resources', 'dark', testNode.icon)),
      light: this.context.asAbsolutePath(path.join('resources', 'light', testNode.icon)),
    };

    return treeItem;
  }

  getChildren(testNode?: TestNode): Thenable<TestNode[]> {
    if (testNode) {
      return Promise.resolve(this.visibleChildrenOf(testNode));
    }
    if (this._discovering) {
      return Promise.resolve([new TestNode('Loading...', null)]);
    }
    return Promise.resolve(this.visibleTests);
  }

  /**
   * The search text the tree is narrowed to. Empty means every test is shown.
   */
  get filter(): string {
    return this._filter;
  }
  set filter(text: string) {
    this._filter = text.trim();
    this.refresh();
  }

  /**
   * The statuses the tree is narrowed to. Empty means any status.
   */
  get statuses(): ReadonlySet<TestStatus> {
    return this._statuses;
  }
  set statuses(statuses: Iterable<TestStatus>) {
    this._statuses = new Set(statuses);
    this.refresh();
  }

  /**
   * Whether the tree is narrowed to something.
   */
  get isFiltered(): boolean {
    return isActive(this.currentFilter);
  }

  private get currentFilter(): TestFilter {
    return { text: this._filter, statuses: this._statuses };
  }

  /**
   * The files that are shown.
   */
  get visibleTests(): TestNode[] {
    return visibleSuites(this._discoveredTests, this.currentFilter);
  }

  /**
   * The tests of a file that are shown.
   */
  visibleChildrenOf(suite: TestNode): TestNode[] {
    return this.isFiltered ? visibleChildren(suite, this.currentFilter) : suite.children;
  }

  /**
   * The file a test belongs to. A file has no parent. Needed to reveal a node.
   */
  getParent(testNode: TestNode): TestNode | undefined {
    return this._discoveredTests.find((suite) => suite.children.includes(testNode));
  }

  get discoveredTests(): TestNode[] {
    return this._discoveredTests;
  }
  getDiscoveredTestNode(key: string): TestNode {
    return this.__discoveredTestsMap.get(key);
  }

  /**
   * Applies the outcome of a test.
   *
   * The tree is not redrawn here: the outcome of every test of a run arrives
   * one after the other, and the tree is redrawn once when the run has
   * finished.
   */
  private updateTestResult(testResult: TestResult) {
    const testNode = this.__discoveredTestsMap.get(
      this.getNodeKey(testResult.uri.fsPath, testResult.testName),
    );
    if (testNode) {
      testNode.testResult = testResult;
      this._pendingResults.add(testNode);
    }
  }

  /**
   * Applies the outcome of a test that finished while its run is still going.
   *
   * The result is applied at once, and the suite it belongs to is redrawn a
   * moment later together with the other results of that moment, so the icon
   * changes within {@link Config.OutcomeRedrawDelay} ms without a redraw per
   * test.
   */
  private onTestOutcome(testResult: TestResult) {
    this.updateTestResult(testResult);
    const suite = this.__discoveredTestsMap.get(
      this.getNodeKey(testResult.uri.fsPath, path.basename(testResult.uri.fsPath)),
    );
    if (suite) {
      this.endSuiteSpinnerWhenDone(suite);
    }
    const node =
      suite ??
      this.__discoveredTestsMap.get(this.getNodeKey(testResult.uri.fsPath, testResult.testName));
    if (!node) {
      return;
    }
    this._pendingOutcomes.add(node);
    if (this._outcomeTimer === undefined) {
      this._outcomeTimer = setTimeout(() => this.flushOutcomes(), Config.OutcomeRedrawDelay);
    }
  }

  /**
   * Ends the spinner of a suite once none of its tests is running.
   *
   * A suite is marked as running when its run starts, and the result of the
   * suite arrives only when the whole run has finished. Without this, a suite
   * whose tests have all finished would keep spinning until the slowest part of
   * the run was over. Its icon then follows its tests: passed, or failed when
   * one of them failed.
   */
  private endSuiteSpinnerWhenDone(suite: TestNode) {
    if (suite.isLoading && !suite.children.some((child) => child.isLoading)) {
      suite.loadingCompleted();
    }
  }
  private onDiscoverTestStart() {
    this._discoveredTests = [];
    this._discovering = true;
    this.refresh();
  }
  private onDicoveredTest(testNodeList: TestNode[]) {
    const previousMap = this.__discoveredTestsMap;
    this._discoveredTests = testNodeList && testNodeList.length > 0 ? testNodeList : [];

    this.__discoveredTestsMap = new Map();
    this._discoveredTests.forEach((x) => this.registerNodeTree(x, previousMap));

    this._discovering = false;
    this.refresh();
  }

  /**
   * Replaces the node for one file, without rebuilding the rest of the
   * tree.
   *
   * The outcome of tests that have already run is carried over, exactly as
   * a full refresh does.
   */
  private onTestFileChanged(testNode: TestNode) {
    const filePath = testNode.uri.fsPath;
    const previous = this.takeEntriesFor(filePath);

    const index = this._discoveredTests.findIndex((node) => node.uri.fsPath === filePath);
    if (index >= 0) {
      this._discoveredTests[index] = testNode;
    } else {
      this._discoveredTests.push(testNode);
    }

    this.registerNodeTree(testNode, previous);
    this.refresh();
  }

  /**
   * Drops the node for a file that no longer holds tests.
   */
  private onTestFileRemoved(filePath: string) {
    const index = this._discoveredTests.findIndex((node) => node.uri.fsPath === filePath);
    if (index >= 0) {
      this._discoveredTests.splice(index, 1);
    }
    this.takeEntriesFor(filePath);
    this.refresh();
  }

  /**
   * Registers a node and, when it is a suite, its children.
   */
  private registerNodeTree(node: TestNode, previousMap: Map<string, TestNode>) {
    if (node.isTestSuite) {
      node.children.forEach((child) => this.registerNodeTree(child, previousMap));
    }
    this.registerNode(node, previousMap);
  }

  /**
   * Removes the lookup entries for one file and returns them, so that the
   * outcome of the tests it holds can be carried over to the new nodes.
   */
  private takeEntriesFor(filePath: string): Map<string, TestNode> {
    const prefix = filePath + '__';
    const taken = new Map<string, TestNode>();
    this.__discoveredTestsMap.forEach((node, key) => {
      if (key.startsWith(prefix)) {
        taken.set(key, node);
        this.__discoveredTestsMap.delete(key);
      }
    });
    return taken;
  }

  /**
   * Registers a node in the lookup map, carrying over the result of the
   * matching node from the previous discovery so that a refresh does not
   * discard the outcome of tests that have already run.
   */
  private registerNode(node: TestNode, previousMap: Map<string, TestNode>) {
    const key = this.getNodeKey(node.uri.fsPath, node.name);
    const previous = previousMap ? previousMap.get(key) : undefined;
    if (previous && previous.testResult && !node.testResult) {
      node.testResult = previous.testResult;
    }
    this.__discoveredTestsMap.set(key, node);
  }
  /**
   * The tests of a run have started.
   *
   * Every test of the run is marked as running, and the tree is redrawn
   * once for the whole run.
   */
  private onTestRunStarted(testNodes: TestNode[]) {
    testNodes.forEach((testNode) => this.setLoading(testNode));
    this.refresh(this.topNodeOf(testNodes));
  }

  /**
   * The run that covers the given files has finished, so the tree is
   * redrawn once with the outcome of every test of that run.
   *
   * A run that covered several files has no single node to redraw, so the
   * whole tree is redrawn.
   */
  private onTestRunCompleted(testUris: vscode.Uri[]) {
    if (testUris.length === 1) {
      const testUri = testUris[0];
      // The file of this run is drawn below, so its waiting results are
      // dropped. The results of other runs that are still going are drawn now.
      this._pendingOutcomes.forEach((node) => {
        if (node.uri.fsPath === testUri.fsPath) {
          this._pendingOutcomes.delete(node);
        }
      });
      this.flushOutcomes();

      const suite = this.__discoveredTestsMap.get(
        this.getNodeKey(testUri.fsPath, path.basename(testUri.fsPath)),
      );
      this.refresh(suite);
      return;
    }
    this.refresh();
  }

  /**
   * The node that holds the others, so the tree is redrawn once for the
   * whole group.
   *
   * A group that spans several suites has no single node to redraw, so the
   * whole tree is redrawn.
   */
  private topNodeOf(testNodes: TestNode[]): TestNode | undefined {
    const tops = testNodes.filter(
      (node) =>
        !testNodes.some(
          (other) => other !== node && other.isTestSuite && other.children.includes(node),
        ),
    );
    return tops.length === 1 ? tops[0] : undefined;
  }

  private setLoading(testNode: TestNode) {
    const tempNode = this.__discoveredTestsMap.get(
      this.getNodeKey(testNode.uri.fsPath, testNode.name),
    );
    if (tempNode) {
      tempNode.setLoading();
    }
  }
  private getNodeKey(uri: string, nodeName: string): string {
    return uri + '__' + nodeName;
  }
}
