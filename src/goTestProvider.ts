import * as vscode from 'vscode';
import * as path from "path";
import { FileSystemProvider } from './fileSystemProvider';
import { getTestFunctions } from './lib/testUtil';
import { TestNode } from './TestNode';
import { Commands } from './commands';
import { TestResult } from './TestResult';
import { TestFinder } from './testFinder';

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
		const treeItem = new vscode.TreeItem(testNode.name, testNode.isTestSuite ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		if (!testNode.isTestSuite) {
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
		if (testNode) {
			return Promise.resolve(testNode.children);
		}
		if (!this.discoveredTests) {
			return Promise.resolve(
				[new TestNode("Loading...", null)])
		}
		return Promise.resolve(this.discoveredTests)
	}

	refreshTestExplorer() {

		this.discoveredTests = null;
		this.refresh();

		//let fileSystemProvider = new FileSystemProvider();
		const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
		const uri = workspaceFolder.uri;
		
		TestFinder.getGoTestFiles(uri).then(items => {
			let promises = items.map(item => {
				let suite = new TestNode(item.name, item.uri)
				return getTestFunctions(suite.uri, null).then(symbols => {
					symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
					let nodeList = symbols.map(symbol => new TestNode(`${symbol.name}`, suite.uri))
					return new TestNode(suite.name, suite.uri, nodeList)
				})
			})
			Promise.all(promises).then(testNodeList => {
				this.commands.sendDiscoveredTest([].concat(...testNodeList))
				this.refresh();
			})

		})


	}

	updateTestResult(testResult: TestResult) {


	}
	onDicoveredTest(testNodeList: TestNode[]) {
		this.discoveredTests = testNodeList
	}
}

