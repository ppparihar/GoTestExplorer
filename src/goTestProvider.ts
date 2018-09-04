import * as vscode from 'vscode';
import * as path from "path";
import { FileSystemProvider } from './fileSystemProvider';
import { getTestFunctions } from './lib/testUtil';
import { TestNode } from './TestNode';
import { Commands } from './commands';

export class GoTestProvider implements vscode.TreeDataProvider<TestNode> {

	private _onDidChangeTreeData: vscode.EventEmitter<TestNode | undefined> = new vscode.EventEmitter<TestNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TestNode | undefined> = this._onDidChangeTreeData.event;

	discoveredTests: TestNode[]
	constructor(private workspaceRoot: string, private context: vscode.ExtensionContext, private commands: Commands) {
		commands.discoveredTest(this.onDicoveredTest, this)
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(testNode: TestNode): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(testNode.label, testNode.isTestsuit ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		if (!testNode.isTestsuit) {
			treeItem.command = {
				command: 'goTestExplorer.runTest',
				title: "show Test list",
				arguments: [testNode]
			};
			treeItem.contextValue = 'tests';
			treeItem.iconPath = {
				dark: this.context.asAbsolutePath(path.join("resources", "dark", testNode.icon)),
				light: this.context.asAbsolutePath(path.join("resources", "light", testNode.icon))
			}
		}


		return treeItem;
	}

	getChildren(testNode?: TestNode): Thenable<TestNode[]> {
		if (!this.workspaceRoot) {
			vscode.window.showInformationMessage('No dependency in empty workspace');
			return Promise.resolve([]);
		}
		if (!this.discoveredTests) {
			return Promise.resolve(
				[new TestNode("Loading...", null, "run.png", false, null)])
		}
		if (testNode) {
			return getTestFunctions(testNode.uri, null).then(symbols => {
				return symbols.map(symbol =>
					new TestNode(`${symbol.name}`, testNode.uri, "run.png", false, symbol)
				)
			})
		}

		return Promise.resolve(this.discoveredTests)


	}
	refreshTestExplorer() {
		
		this.discoveredTests = null;
		this.refresh();
		
		let fileSystemProvider = new FileSystemProvider();
		fileSystemProvider.getChildren().then(items => {
			let testNodeList = items.map(item => new TestNode(item.name, item.uri, "testSuit.svg", true))
			this.commands.sendDiscoveredTest(testNodeList)
			this.refresh();
		})


	}
	addTestResult(testNode: TestNode) {

	}
	onDicoveredTest(testNodeList: TestNode[]) {
		this.discoveredTests = testNodeList
	}
}

