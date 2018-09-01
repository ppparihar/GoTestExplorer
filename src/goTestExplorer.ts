import * as vscode from 'vscode';

import { GoTestProvider } from './goTestProvider';

export class GoTestExplorer {

    constructor(context: vscode.ExtensionContext) {

        const goTestProvider = new GoTestProvider(vscode.workspace.rootPath);

        vscode.window.registerTreeDataProvider('testExplorer', goTestProvider);

        let disposable = vscode.commands.registerCommand('goTestExplorer.openTestList', (message, uri) => {

            vscode.window.showInformationMessage(`${message} - ${uri}`);
        });
        context.subscriptions.push(disposable);
    }
}