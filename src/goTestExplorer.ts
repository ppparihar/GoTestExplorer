import * as vscode from 'vscode';
import * as path from 'path';
import { GoTestProvider } from './goTestProvider';
import { runGoTest, TestConfig } from './lib/testUtil';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';
import { RawTestResult } from './rawTestResult';
import { TestDiscovery } from './testDiscovery';
import { Config } from './config';
import { TestQueue } from './runner/testQueue';
import { scanGoSource } from './discovery/goScanner';

export class GoTestExplorer {

    goTestProvider: GoTestProvider;

    readonly commands: Commands;
    private readonly testQueue: TestQueue;

    constructor(context: vscode.ExtensionContext) {
        this.commands = new Commands();
        this.goTestProvider = new GoTestProvider(context, this.commands);
        const testDiscoverer = new TestDiscovery(this.commands, context);
        this.testQueue = new TestQueue(
            (testConfig) => runGoTest(testConfig),
            Config.RunMaxParallelTest,
            (testConfig, result) => this.onRunCompleted(testConfig, result),
            (testConfig, error) => this.onRunFailed(testConfig, error));
        vscode.window.registerTreeDataProvider('goTestExplorer', this.goTestProvider);


        context.subscriptions.push(vscode.commands.registerCommand('goTestExplorer.runTest', this.onRunSingleTest.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.runAllTest", this.onRunAllTests.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.refreshTestExplorer", () => {
            testDiscoverer.discoverAllTests();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.showTestoutput", (testNode: TestNode) => {
            let output = testNode.testResult && testNode.testResult.output && testNode.testResult.output.length > 0 ? testNode.testResult.output.join("\n") : "No output";
            vscode.window.showInformationMessage(output);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.goToLocation", this.go.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand('goTestExplorer.runTestSuite', this.runTestSuite.bind(this)));
        testDiscoverer.discoverAllTests();

    }
    async onRunSingleTest(testNode: TestNode) {
        this.commands.sendTestRunStarted(testNode);
        const testConfig = this.buildTestConfig(testNode);
        this.enqueueTest(testConfig);
    }
    private runTestSuite(testNode: TestNode) {
        if (testNode.children.length === 0) {
            return;
        }
        testNode.children.forEach(t => this.commands.sendTestRunStarted(t));
        this.commands.sendTestRunStarted(testNode);
        const testConfig = this.buildTestConfig(testNode);
        this.enqueueTest(testConfig);
    }

    private onRunAllTests() {
        this.goTestProvider.discoveredTests.
            filter(s => s.isTestSuite).
            forEach(t => this.runTestSuite(t));
    }

    private buildTestConfig(testNode: TestNode): TestConfig {
        let tests = testNode.children.map(node => node.name);
        tests = tests.length > 0 ? tests : [testNode.name];
        const testConfig: TestConfig = {
            dir: path.dirname(testNode.uri.fsPath),
            goConfig: vscode.workspace.getConfiguration('go', testNode.uri),
            flags: [],
            functions: tests,
            testUri: testNode.uri,
            testName: path.basename(testNode.uri.fsPath)
        };
        return testConfig;
    }

    private enqueueTest(testConfig: TestConfig) {
        this.testQueue.enqueue(testConfig);
    }

    /**
     * A test invocation finished. Attribute the outcome to each test that was
     * requested and report the suite-level result.
     */
    private onRunCompleted(testConfig: TestConfig, result: RawTestResult) {
        let isTestSuitePassed = true;
        testConfig.functions.forEach(t => {
            let isTestPassed = true;
            if (result.isPassed === false && (!result.failedTests || result.failedTests.length === 0 || result.failedTests.indexOf(t) !== -1)) {
                isTestPassed = false;
                isTestSuitePassed = false;
            }
            this.commands.sendTestResult(new TestResult(testConfig.testUri, t, isTestPassed, result.output, result.err));
        });

        this.commands.sendTestResult(new TestResult(testConfig.testUri, testConfig.testName, isTestSuitePassed, result.output, result.err));
        this.commands.sendTestCompleted();
    }

    /**
     * A test invocation failed outright. Report the whole suite as failed
     * rather than leaving it spinning forever.
     */
    private onRunFailed(testConfig: TestConfig, error: Error) {
        const output = [error.message];
        testConfig.functions.forEach(t => {
            this.commands.sendTestResult(new TestResult(testConfig.testUri, t, false, output, error));
        });
        this.commands.sendTestResult(new TestResult(testConfig.testUri, testConfig.testName, false, output, error));
        this.commands.sendTestCompleted();
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
            const declaration = scan.declarations.find(d => d.name === testNode.name);

            if (!declaration) {
                throw new Error("Could not find test (no symbols matching)");
            }

            await vscode.window.showTextDocument(document);
            const selection = new vscode.Selection(
                new vscode.Position(declaration.line, declaration.startChar),
                new vscode.Position(declaration.line, declaration.endChar));
            vscode.window.activeTextEditor.selection = selection;
            vscode.window.activeTextEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
        } catch (r) {
            vscode.window.showWarningMessage(r instanceof Error ? r.message : String(r));
        }
    }

}

