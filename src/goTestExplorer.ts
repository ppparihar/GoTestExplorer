import * as vscode from 'vscode';
import path = require('path');
import { GoTestProvider } from './goTestProvider';
import { runGoTest, getTestFunctions } from './lib/testUtil';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';
import { TestDiscovery } from './testDiscovery';

export class GoTestExplorer {

    goTestProvider: GoTestProvider;
    readonly commands: Commands;
    constructor(context: vscode.ExtensionContext) {

        this.commands = new Commands();
        this.goTestProvider = new GoTestProvider(context, this.commands);
        const testDiscoverer = new TestDiscovery(this.commands);
        vscode.window.registerTreeDataProvider('goTestExplorer', this.goTestProvider);

        context.subscriptions.push(vscode.commands.registerCommand('goTestExplorer.runTest', this.onRunSingleTest.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.runAllTest", this.onRunAllTests.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.refreshTestExplorer", () => {
            testDiscoverer.discoverAllTests();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.showTestoutput", (testNode: TestNode) => {

            let output = testNode.testResult && testNode.testResult.output && testNode.testResult.output.length > 0 ? testNode.testResult.output.join("\n") : "No output"

            vscode.window.showInformationMessage(output);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.goToLocation", (testNode: TestNode) => {
            this.go(testNode);
        }));


        testDiscoverer.discoverAllTests();

    }
    async onRunSingleTest(testNode: TestNode) {

        const testConfig = {
            dir: path.dirname(testNode.uri.fsPath),
            goConfig: vscode.workspace.getConfiguration('go', testNode.uri),
            flags: [""],
            functions: [testNode.name]
        }
        this.commands.sendTestRunStarted(testNode);
        const result = await runGoTest(testConfig);

        this.commands.sendTestResult(
            new TestResult(testNode.uri, testNode.name, result.isPassed, result.output, result.err))

    }

    onRunAllTests() {
        this.goTestProvider.discoveredTests.
            filter(s => s.children && s.children.length > 0).
            forEach(s => s.children.forEach(t => this.onRunSingleTest(t)))
    }

    public async go(testNode: TestNode): Promise<void> {

        const symbols = await getTestFunctions(testNode.uri, null);

        try {
            const symbol = this.findTestLocation(symbols, testNode);

            const doc = await vscode.workspace.openTextDocument(testNode.uri);//.then((doc) => {
            // const byteOffsetToDocumentOffset = makeMemoizedByteOffsetConverter(new Buffer(doc.getText()));
            // let start =byteOffsetToDocumentOffset(998 - 1);
            // let end = byteOffsetToDocumentOffset(1057 - 1);


            await vscode.window.showTextDocument(doc);//.then((editor) => {
            // const loc = new vscode.Range(doc.positionAt(start), doc.positionAt(end));
            const loc = symbol.location.range;
            const selection = new vscode.Selection(loc.start.line, loc.start.character, loc.end.line, loc.end.character);
            vscode.window.activeTextEditor.selection = selection;
            vscode.window.activeTextEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);

        } catch (r) {

            vscode.window.showWarningMessage(r.message);
        }


    }
    public findTestLocation(symbols: vscode.SymbolInformation[], testNode: TestNode): vscode.SymbolInformation {

        if (symbols.length === 0) {
            throw new Error("Could not find test (no symbols found)");
        }

        const testName = testNode.name;

        symbols = symbols.filter((s) => s.kind === vscode.SymbolKind.Function && s.name === testName);

        if (symbols.length === 0) {
            throw Error("Could not find test (no symbols matching)");
        }

        if (symbols.length > 1) {
            throw Error("Could not find test (found multiple matching symbols)");
        }

        return symbols[0];
    }

}