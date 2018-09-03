import * as vscode from 'vscode';
import * as path from "path";
import { FileSystemProvider } from './fileSystemProvider';
import { getTestFunctions } from './lib/testUtil';
import { TestNode } from './TestNode';

export class GoTestProvider implements vscode.TreeDataProvider<TestNode> {

	private _onDidChangeTreeData: vscode.EventEmitter<TestNode | undefined> = new vscode.EventEmitter<TestNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TestNode | undefined> = this._onDidChangeTreeData.event;

	constructor(private workspaceRoot: string, private context: vscode.ExtensionContext) {
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TestNode): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(element.label, element.isTestsuit ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		if (!element.isTestsuit) {
			treeItem.command = {
				command: 'goTestExplorer.runTest',
				title: "show Test list",
				arguments: [element]
			};
			treeItem.contextValue = 'tests';
			treeItem.iconPath = {
				dark: this.context.asAbsolutePath(path.join("resources", "dark", element.icon)),
				light: this.context.asAbsolutePath(path.join("resources", "light", element.icon))
			}
		}
		

		return treeItem;
	}

	getChildren(element?: TestNode): Thenable<TestNode[]> {
		if (!this.workspaceRoot) {
			vscode.window.showInformationMessage('No dependency in empty workspace');
			return Promise.resolve([]);
		}
		if (element) {
			return getTestFunctions(element.uri, null).then(symbols => {
				return symbols.map(symbol =>
					new TestNode(`${symbol.name}`, element.uri, "run.png", false, symbol)
				)
			})

		}
		let fileSystemProvider = new FileSystemProvider()
		return fileSystemProvider.getChildren().then(items => {
			return items.map(item => {
				return new TestNode(item.name, item.uri, "testSuit.svg", true)
			})
		})

	}


}

