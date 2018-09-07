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


        this.goTestProvider.refreshTestExplorer();

    }
    async onRunSingleTest(testNode: TestNode) {

        let testConfig = {
            dir: path.dirname(testNode.uri.fsPath),
            goConfig: vscode.workspace.getConfiguration('go', testNode.uri),
            flags: [""],
            functions: [testNode.name]
        }

        let result = await runGoTest(testConfig)
        this.goTestProvider.updateTestResult(new TestResult(testNode.uri, testNode.name, result))


    }
    onRunAllTests() {
        this.goTestProvider.discoveredTests.forEach(s => {
            if (s.children && s.children.length > 0) {
                s.children.forEach(t => this.onRunSingleTest(t))
            }
        })
    }
}