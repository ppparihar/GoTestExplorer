import { EventEmitter, Event, Uri } from 'vscode';
import { TestNode } from './testNode';
import { TestResult } from './testResult';

export class Commands {
  private readonly onTestDiscoveryFinishedEmitter = new EventEmitter<TestNode[]>();
  private readonly onTestDiscoveryStartedEmitter = new EventEmitter<void>();
  private readonly onTestRunStartedEmitter = new EventEmitter<TestNode[]>();
  private readonly onTestResultEmitter = new EventEmitter<TestResult>();
  private readonly onTestCompletedEmitter = new EventEmitter<Uri[]>();
  private readonly onTestFileChangedEmitter = new EventEmitter<TestNode>();
  private readonly onTestFileRemovedEmitter = new EventEmitter<string>();

  public get discoveredTest(): Event<TestNode[]> {
    return this.onTestDiscoveryFinishedEmitter.event;
  }
  public sendDiscoveredTests(testNodeList: TestNode[]) {
    this.onTestDiscoveryFinishedEmitter.fire(testNodeList);
  }
  public get testDiscoveryStarted(): Event<void> {
    return this.onTestDiscoveryStartedEmitter.event;
  }
  public sendTestDiscoveryStarted() {
    this.onTestDiscoveryStartedEmitter.fire();
  }
  /**
   * The tests that are about to run.
   *
   * Every test of a run is reported in one event, so the tree is redrawn
   * once for the whole run rather than once per test.
   */
  public get testRunStarted(): Event<TestNode[]> {
    return this.onTestRunStartedEmitter.event;
  }
  public sendTestRunStarted(testNodes: TestNode[]) {
    this.onTestRunStartedEmitter.fire(testNodes);
  }
  public get testResult(): Event<TestResult> {
    return this.onTestResultEmitter.event;
  }
  public sendTestResult(testResult: TestResult) {
    this.onTestResultEmitter.fire(testResult);
  }

  /**
   * The run that covers the given files has finished, so the tree can be
   * redrawn once with the outcome of every test of that run.
   *
   * A run that tests one file names one URI. A run that tests several
   * packages names every file it covered, so that the tree is redrawn once
   * for all of them.
   */
  public get testCompleted(): Event<Uri[]> {
    return this.onTestCompletedEmitter.event;
  }
  public sendTestCompleted(testUris: Uri[]): void {
    this.onTestCompletedEmitter.fire(testUris);
  }

  /**
   * The tests in one file changed, so the node for that file is replaced
   * without rebuilding the rest of the tree.
   */
  public get testFileChanged(): Event<TestNode> {
    return this.onTestFileChangedEmitter.event;
  }
  public sendTestFileChanged(testNode: TestNode) {
    this.onTestFileChangedEmitter.fire(testNode);
  }

  /**
   * A file that held tests is gone, so its node is dropped.
   */
  public get testFileRemoved(): Event<string> {
    return this.onTestFileRemovedEmitter.event;
  }
  public sendTestFileRemoved(filePath: string) {
    this.onTestFileRemovedEmitter.fire(filePath);
  }
}
