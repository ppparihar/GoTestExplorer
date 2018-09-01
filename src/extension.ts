'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
//import { TestCasesProvider } from './testCasesProvider';
//import { FileExplorer, FileSystemProvider } from './fileExplorer';
import { GoTestProvider } from './goTestProvider';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "hello-vs" is now active!');
	const testCasesProvider = new GoTestProvider(vscode.workspace.rootPath);
    vscode.window.registerTreeDataProvider('testExplorer', testCasesProvider);
   // new FileExplorer(context);

    let disposable = vscode.commands.registerCommand('goTestExplorer.openTestList', (message,uri) => {
        
        vscode.window.showInformationMessage(`${message} - ${uri}`);
    });


    context.subscriptions.push(disposable);
   


}

// this method is called when your extension is deactivated
export function deactivate() {
}