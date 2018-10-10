import * as vscode from 'vscode';
import * as path from "path";
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';


export class GoTestProvider implements vscode.TreeDataProvider<TestNode> {

	private _onDidChangeTreeData: vscode.EventEmitter<TestNode | undefined> = new vscode.EventEmitter<TestNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TestNode | undefined> = this._onDidChangeTreeData.event;

	_discoveredTests: TestNode[];
	private _discovering: boolean;
	constructor(private context: vscode.ExtensionContext, commands: Commands) {
		context.subscriptions.push(commands.discoveredTest(this.onDicoveredTest, this));
		context.subscriptions.push(commands.testDiscoveryStarted(this.onDiscoverTestStart, this));
		context.subscriptions.push(commands.testResult(this.updateTestResult, this));
		context.subscriptions.push(commands.testRunStarted(this.onTestRunStarted, this))
	}

	private refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(testNode: TestNode): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(testNode.name, testNode.isTestSuite ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

		treeItem.contextValue = this._discovering ? 'discovering' : testNode.isTestSuite ? 'testSuite' : 'test'

		if (!testNode.isTestSuite) {
			treeItem.command = {
				command: 'goTestExplorer.goToLocation',
				title: testNode.tooltip,
				arguments: [testNode]
			};

		}

		treeItem.iconPath = {
			dark: this.context.asAbsolutePath(path.join("resources", "dark", testNode.icon)),
			light: this.context.asAbsolutePath(path.join("resources", "light", testNode.icon))
		}

		return treeItem;
	}

	getChildren(testNode?: TestNode): Thenable<TestNode[]> {
		if (testNode) {
			return Promise.resolve(testNode.children);
		}
		if (this._discovering) {
			return Promise.resolve(
				[new TestNode("Loading...", null)])
		}
		return Promise.resolve(this._discoveredTests)
	}
	get discoveredTests(): TestNode[] {
		return this._discoveredTests;
	}

	private updateTestResult(testResult: TestResult) {

		let index = this.discoveredTests.findIndex(s => s.uri === testResult.uri);
		if (index > -1) {
			let index2 = this.discoveredTests[index].children.findIndex(t => t.name === testResult.testName);
			if (index2 > -1)
				this.discoveredTests[index].children[index2].testResult = testResult;
		}
		this.refresh();
	}
	private onDiscoverTestStart() {
		this._discoveredTests = [];
		this._discovering = true
		this.refresh();
	}
	private onDicoveredTest(testNodeList: TestNode[]) {
		this._discoveredTests = testNodeList && testNodeList.length > 0 ? testNodeList : [];
		this._discovering = false;
		this.refresh();
	}
	private onTestRunStarted(testNode: TestNode) {
		testNode ? this.setLoading(testNode) : this.setAlloading()
	}
	private setLoading(testNode: TestNode) {
		let index = this.discoveredTests.findIndex(s => s.uri === testNode.uri);
		if (index > -1) {
			let index2 = this.discoveredTests[index].children.findIndex(t => t.name === testNode.name);
			if (index2 > -1)
				this.discoveredTests[index].children[index2].setLoading();
		}
		this.refresh();
	}
	private setAlloading() {
		this.discoveredTests.
			filter(s => s.children && s.children.length > 0).
			forEach(s => s.children.forEach(t => t.setLoading()));

		this.refresh();
	}
}

