import * as vscode from 'vscode';
import path = require('path');
import { GoTestProvider } from './goTestProvider';
import { goTest } from './lib/testUtil';
import { TestNode } from './TestNode';
import { Commands } from './commands';

export class GoTestExplorer {

    constructor(context: vscode.ExtensionContext) {

        const commands = new Commands();
        const goTestProvider = new GoTestProvider(vscode.workspace.rootPath,context,commands);

        vscode.window.registerTreeDataProvider('goTestExplorer', goTestProvider);

        let disposable = vscode.commands.registerCommand('goTestExplorer.runTest', this.onRunSingleTest)
        context.subscriptions.push(vscode.commands.registerCommand("goTestExplorer.refreshTestExplorer", () => {
            goTestProvider.refreshTestExplorer();
        }));
        context.subscriptions.push(disposable);
    }
    onRunSingleTest(testNode: TestNode) {
        vscode.window.showInformationMessage(` ${testNode.uri}`);
        
        let testConfig = {
            dir: path.dirname(testNode.uri.fsPath),
            goConfig: vscode.workspace.getConfiguration('go',testNode. uri),
            flags: [""],
            functions: [testNode.symbol.name]
        }
        goTest(testConfig).then(result=>{
            
        })
    }
}