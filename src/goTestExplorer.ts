import * as vscode from 'vscode';
import path = require('path');
import { GoTestProvider } from './goTestProvider';
import { goTest } from './lib/testUtil';
import { TestNode } from './TestNode';

export class GoTestExplorer {

    constructor(context: vscode.ExtensionContext) {

        const goTestProvider = new GoTestProvider(vscode.workspace.rootPath,context);

        vscode.window.registerTreeDataProvider('testExplorer', goTestProvider);

        let disposable = vscode.commands.registerCommand('goTestExplorer.runTest', this.onRunSingleTest)
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