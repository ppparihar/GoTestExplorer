import * as vscode from 'vscode';
import * as path from 'path';
import { GoTestProvider } from './goTestProvider';
import { runGoTest, TestConfig, TestPackage, cancelRunningTests } from './lib/testUtil';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';
import { RawTestResult } from './rawTestResult';
import { TestDiscovery } from './testDiscovery';
import { Config } from './config';
import { TestQueue } from './runner/testQueue';
import { scanGoSource } from './discovery/goScanner';
import { hasFailed, PackageResult } from './exec/goTestJsonParser';
import { findGoModule, GoModule, importPathOf } from './lib/goModule';
import { testOutput } from './lib/testOutput';

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
        const cancelTestRun = () => {
            // The invocations that have not started are dropped, and the ones
            // that are running are killed.
            this.testQueue.cancel();
            const stopped = cancelRunningTests();
            if (stopped === 0) {
                vscode.window.showInformationMessage('No test run is in progress.');
            }
        };
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.cancelTestRun", cancelTestRun));
        // Ctrl+C in the terminal of the output stops the runs, the way it
        // stops a command in any other terminal.
        testOutput.setCancelHandler(cancelTestRun);
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.showTestoutput", (testNode: TestNode) => {
            let output = testNode.testResult && testNode.testResult.output && testNode.testResult.output.length > 0 ? testNode.testResult.output.join("\n") : "No output";
            vscode.window.showInformationMessage(output);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.goToLocation", this.go.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand('goTestExplorer.runTestSuite', this.runTestSuite.bind(this)));
        testDiscoverer.discoverAllTests();

    }
    async onRunSingleTest(testNode: TestNode) {
        this.commands.sendTestRunStarted([testNode]);
        const testConfig = this.buildTestConfig(testNode);
        this.enqueueTest(testConfig);
    }
    private runTestSuite(testNode: TestNode) {
        if (testNode.children.length === 0) {
            return;
        }
        // Every test of the suite is reported in one event, so the tree is
        // redrawn once for the whole suite.
        this.commands.sendTestRunStarted([...testNode.children, testNode]);
        const testConfig = this.buildTestConfig(testNode);
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
        const suites = this.goTestProvider.discoveredTests.filter(s => s.isTestSuite);
        const groups = new Map<string, ModuleGroup>();
        const withoutModule: TestNode[] = [];

        // The files of one directory belong to one package.
        const byDirectory = new Map<string, TestNode[]>();
        suites.forEach(suite => {
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
                files: files.map(file => ({
                    uri: file.uri,
                    name: file.name,
                    functions: file.children.map(child => child.name)
                }))
            });
            group.suites.push(...files);
        });

        withoutModule.forEach(suite => this.runTestSuite(suite));
        groups.forEach(group => this.runModule(group));
    }

    /**
     * Runs every test of a module in one process.
     */
    private runModule(group: ModuleGroup) {
        // Every test of the module is reported in one event, so the tree is
        // redrawn once for the whole module.
        const nodes: TestNode[] = [];
        group.suites.forEach(suite => nodes.push(...suite.children, suite));
        this.commands.sendTestRunStarted(nodes);

        const testConfig: TestConfig = {
            dir: group.module.root,
            goConfig: vscode.workspace.getConfiguration('go', group.suites[0].uri),
            flags: [],
            functions: group.suites.reduce((all, suite) => all.concat(suite.children.map(child => child.name)), [] as string[]),
            testUri: group.suites[0].uri,
            testName: group.suites[0].name,
            packages: group.packages
        };
        this.enqueueTest(testConfig);
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
        if (testConfig.packages && testConfig.packages.length > 0) {
            this.onModuleRunCompleted(testConfig, result);
            return;
        }
        let isTestSuitePassed = true;
        testConfig.functions.forEach(t => {
            let isTestPassed = true;
            // A test fails when it or one of its subtests failed, so a
            // failure in `TestAlpha/sub` marks `TestAlpha` as failed.
            if (result.isPassed === false && (!result.failedTests || result.failedTests.length === 0 || hasFailed(result.failedTests, t))) {
                isTestPassed = false;
                isTestSuitePassed = false;
            }
            this.commands.sendTestResult(new TestResult(testConfig.testUri, t, isTestPassed, result.output, result.err));
        });

        this.commands.sendTestResult(new TestResult(testConfig.testUri, testConfig.testName, isTestSuitePassed, result.output, result.err));
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

        testConfig.packages!.forEach(pkg => {
            const packageResult = result.packages.get(pkg.importPath);
            const failed = packageResult ? packageResult.failed : !result.isPassed;
            const failedTests = packageResult ? packageResult.failedTests : result.failedTests;
            const output = packageResult ? this.outputOfPackage(packageResult, result) : result.output;

            pkg.files.forEach(file => {
                uris.push(file.uri);
                let isFilePassed = true;
                file.functions.forEach(t => {
                    let isTestPassed = true;
                    // A test fails when it or one of its subtests failed, so a
                    // failure in `TestAlpha/sub` marks `TestAlpha` as failed.
                    if (failed && (failedTests.length === 0 || hasFailed(failedTests, t))) {
                        isTestPassed = false;
                        isFilePassed = false;
                    }
                    this.commands.sendTestResult(new TestResult(file.uri, t, isTestPassed, output, result.err));
                });
                this.commands.sendTestResult(new TestResult(file.uri, file.name, isFilePassed, output, result.err));
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
            testConfig.packages!.forEach(pkg => {
                pkg.files.forEach(file => {
                    uris.push(file.uri);
                    file.functions.forEach(t => {
                        this.commands.sendTestResult(new TestResult(file.uri, t, false, output, error));
                    });
                    this.commands.sendTestResult(new TestResult(file.uri, file.name, false, output, error));
                });
            });
            this.commands.sendTestCompleted(uris);
            return;
        }
        testConfig.functions.forEach(t => {
            this.commands.sendTestResult(new TestResult(testConfig.testUri, t, false, output, error));
        });
        this.commands.sendTestResult(new TestResult(testConfig.testUri, testConfig.testName, false, output, error));
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

