'use strict';
import * as vscode from 'vscode';
import { GoTestExplorer } from './goTestExplorer';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    new GoTestExplorer(context)
     
}

// this method is called when your extension is deactivated
export function deactivate() {
}