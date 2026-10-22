'use strict';
import * as vscode from 'vscode';
import { GoTestExplorer } from './goTestExplorer';
import { isToolAvailable } from './lib/testUtil';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Failing here, with a clear message, is much better than failing later
    // with an empty test tree and no explanation.
    if (!isToolAvailable('go')) {
        vscode.window.showErrorMessage(
            'Cannot find the "go" binary. Go Test Explorer needs it to run tests. '
            + 'Install Go and make sure it is on your PATH, then reload the window.');
    }

    new GoTestExplorer(context)

}

// this method is called when your extension is deactivated
export function deactivate() {
}
