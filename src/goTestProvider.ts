import * as vscode from 'vscode';
import { FileSystemProvider } from './fileSystemProvider';

export class GoTestProvider implements vscode.TreeDataProvider<Dependency> {

	private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined> = new vscode.EventEmitter<Dependency | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Dependency | undefined> = this._onDidChangeTreeData.event;

	constructor(private workspaceRoot: string) {
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Dependency): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(element.label, element.isTestsuit ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		if(!element.isTestsuit)
		treeItem.command = { command: 'goTestExplorer.openTestList', title: "show Test list", arguments: [element.label, element.uri], };
		treeItem.contextValue = 'tests';

		return treeItem;
	}

	getChildren(element?: Dependency): Thenable<Dependency[]> {
		if (!this.workspaceRoot) {
			vscode.window.showInformationMessage('No dependency in empty workspace');
			return Promise.resolve([]);
		}
		if (element) {
			return Promise.resolve([
				new Dependency(`${element.label} Test 1`, element.uri, vscode.TreeItemCollapsibleState.None),
				new Dependency(`${element.label} Test 2`, element.uri, vscode.TreeItemCollapsibleState.None),
				new Dependency(`${element.label} Test 3`, element.uri, vscode.TreeItemCollapsibleState.None),
			]);
		}
		let fileSystemProvider = new FileSystemProvider()
		return fileSystemProvider.getChildren().then(items => {
			return items.map(item => {
				return new Dependency(item.name, item.uri, vscode.TreeItemCollapsibleState.Collapsed, true)
			})
		})

	}


}

class Dependency extends vscode.TreeItem {

	constructor(
		public readonly label: string,
		public uri: vscode.Uri,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly isTestsuit?: boolean,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);
	}

	get tooltip(): string {
		return `${this.label}`
	}

	contextValue = 'dependency';

}