import * as vscode from 'vscode';
import * as path from "path";

import { getTestFunctions } from './lib/testUtil';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';
import { TestFinder } from './testFinder';

export class GoTestProvider implements vscode.TreeDataProvider<TestNode> {

	private _onDidChangeTreeData: vscode.EventEmitter<TestNode | undefined> = new vscode.EventEmitter<TestNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TestNode | undefined> = this._onDidChangeTreeData.event;

	_discoveredTests: TestNode[]
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
				command: 'goTestExplorer.goToLocation',
				title:testNode.tooltip,
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
		if (!this._discoveredTests) {
			return Promise.resolve(
				[new TestNode("Loading...", null)])
		}
		return Promise.resolve(this._discoveredTests)
	}

	refreshTestExplorer() {

		this._discoveredTests = [];
		this.refresh();

		const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
		const uri = workspaceFolder.uri;

		this.discoverTests(uri).catch(err => {
			console.error(err)
		})
	}

	async discoverTests(uri: vscode.Uri) {
		const items = await TestFinder.getGoTestFiles(uri);
		let promises = items.map(async item => {
			let suite = new TestNode(item.name, item.uri)
			let symbols = await getTestFunctions(suite.uri, null)

			symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
			let nodeList = symbols.map(symbol => new TestNode(`${symbol.name}`, suite.uri))
			return new TestNode(suite.name, suite.uri, nodeList)
		});

		Promise.all(promises).then(testNodeList => {
			this.commands.sendDiscoveredTests([].concat(...testNodeList))
			this.refresh();
		})
	}

	updateTestResult(testResult: TestResult) {

		let index = this.discoveredTests.findIndex(s => s.uri === testResult.uri);
		if (index > -1) {
			let index2 = this.discoveredTests[index].children.findIndex(t => t.name === testResult.functionName);
			if (index2 > -1)
				this.discoveredTests[index].children[index2].testResult = testResult;
		}
		this.refresh();
	}
	onDicoveredTest(testNodeList: TestNode[]) {
		this._discoveredTests = testNodeList
	}
	get discoveredTests(): TestNode[] {
		return this._discoveredTests;
	}

	setLoading(testNode:TestNode){
		let index = this.discoveredTests.findIndex(s => s.uri === testNode.uri);
		if (index > -1) {
			let index2 = this.discoveredTests[index].children.findIndex(t => t.name === testNode.name);
			if (index2 > -1)
				this.discoveredTests[index].children[index2].setLoading();
		}
		this.refresh();
	}
	setAlloading(){
		this.discoveredTests.
		filter(s => s.children && s.children.length > 0).
		forEach(s => s.children.forEach(t => t.setLoading()));

		this.refresh();
	}
}

