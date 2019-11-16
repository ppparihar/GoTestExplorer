import { EventEmitter, Event } from "vscode";
import { TestNode } from "./testNode";
import { TestResult } from "./testResult";

export class Commands {

    private readonly onTestDiscoveryFinishedEmitter = new EventEmitter<TestNode[]>();
    private readonly onTestRediscoveryFinishedEmitter = new EventEmitter<TestNode[]>();
    private readonly onTestDiscoveryStartedEmitter = new EventEmitter<void>();
    private readonly onTestRunStartedEmitter = new EventEmitter<TestNode>();
    private readonly onTestResultEmitter = new EventEmitter<TestResult>();
    private readonly onTestCompletedEmitter = new EventEmitter<void>();

    public get discoveredTest(): Event<TestNode[]> {
        return this.onTestDiscoveryFinishedEmitter.event;
    }
    public get rediscoveredTest(): Event<TestNode[]> {
        return this.onTestRediscoveryFinishedEmitter.event;
    }
    public sendDiscoveredTests(testNodeList: TestNode[]) {
        this.onTestDiscoveryFinishedEmitter.fire(testNodeList);
    }
    public sendRediscoveredTests(testNodeList: TestNode[]) {
        this.onTestRediscoveryFinishedEmitter.fire(testNodeList);
    }
    public get testDiscoveryStarted(): Event<void> {
        return this.onTestDiscoveryStartedEmitter.event;
    }
    public sendTestDiscoveryStarted() {
        this.onTestDiscoveryStartedEmitter.fire();

    }
    public get testRunStarted(): Event<TestNode> {
        return this.onTestRunStartedEmitter.event;
    }
    public sendTestRunStarted(testNode: TestNode) {
        this.onTestRunStartedEmitter.fire(testNode);
    }
    public get testResult(): Event<TestResult> {
        return this.onTestResultEmitter.event;
    }
    public sendTestResult(testResult: TestResult) {
        this.onTestResultEmitter.fire(testResult);
    }
    public get testCompleted(): Event<void> {
        return this.onTestCompletedEmitter.event;
    }
    public sendTestCompleted() :void {
        this.onTestCompletedEmitter.fire();
    }
}
