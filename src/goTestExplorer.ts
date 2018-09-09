import * as vscode from 'vscode';
import path = require('path');
import { GoTestProvider } from './goTestProvider';
import { runGoTest } from './lib/testUtil';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';

export class GoTestExplorer {

    goTestProvider: GoTestProvider;
    constructor(context: vscode.ExtensionContext) {

        const commands = new Commands();
        this.goTestProvider = new GoTestProvider(vscode.workspace.rootPath, context, commands);

        vscode.window.registerTreeDataProvider('goTestExplorer', this.goTestProvider);

        context.subscriptions.push(vscode.commands.registerCommand('goTestExplorer.runTest', this.onRunSingleTest.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.runAllTest", this.onRunAllTests.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.refreshTestExplorer", () => {
            this.goTestProvider.refreshTestExplorer();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.showTestoutput", (testNode: TestNode) => {

            let output = testNode.testResult && testNode.testResult.output && testNode.testResult.output.length > 0 ? testNode.testResult.output.join("\n") : "No output"

            vscode.window.showInformationMessage(output);
        }));


        this.goTestProvider.refreshTestExplorer();

    }
    async onRunSingleTest(testNode: TestNode) {

        let testConfig = {
            dir: path.dirname(testNode.uri.fsPath),
            goConfig: vscode.workspace.getConfiguration('go', testNode.uri),
            flags: [""],
            functions: [testNode.name]
        }
        this.goTestProvider.setLoading(testNode)

        let result = await runGoTest(testConfig)
        this.goTestProvider.updateTestResult(
            new TestResult(testNode.uri, testNode.name, result.isPassed, result.output, result.err))


    }

    onRunAllTests() {
        this.goTestProvider.setAlloading();
        this.goTestProvider.discoveredTests.
            filter(s => s.children && s.children.length > 0).
            forEach(s => s.children.forEach(t => this.onRunSingleTest(t)))
    }
}