import * as vscode from 'vscode';
import * as path from "path";
import { TestNode } from './testNode';
import { Commands } from './commands';
import { TestResult } from './testResult';


export class GoTestProvider implements vscode.TreeDataProvider<TestNode> {

	private _onDidChangeTreeData: vscode.EventEmitter<TestNode | undefined> = new vscode.EventEmitter<TestNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TestNode | undefined> = this._onDidChangeTreeData.event;

	private __discoveredTestsMap: Map<string, TestNode>;
	private _discoveredTests: TestNode[];
	private _discovering: boolean;
	constructor(private context: vscode.ExtensionContext, commands: Commands) {
		context.subscriptions.push(commands.discoveredTest(this.onDicoveredTest, this));
		context.subscriptions.push(commands.testDiscoveryStarted(this.onDiscoverTestStart, this));
		context.subscriptions.push(commands.testResult(this.updateTestResult, this));
		context.subscriptions.push(commands.testRunStarted(this.onTestRunStarted, this));
	}

	private refresh(testNode?: TestNode): void {
		this._onDidChangeTreeData.fire(testNode);
	}

	getTreeItem(testNode: TestNode): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(testNode.name, testNode.isTestSuite ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

		treeItem.contextValue = this._discovering ? 'discovering' : testNode.isTestSuite ? 'testSuite' : 'test';

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
		};

		return treeItem;
	}

	getChildren(testNode?: TestNode): Thenable<TestNode[]> {
		if (testNode) {
			return Promise.resolve(testNode.children);
		}
		if (this._discovering) {
			return Promise.resolve(
				[new TestNode("Loading...", null)]);
		}
		return Promise.resolve(this._discoveredTests);
	}
	get discoveredTests(): TestNode[] {
		return this._discoveredTests;
	}
	getDiscoveredTestNode(key: string): TestNode {
		return this.__discoveredTestsMap.get(key);
	}

	private updateTestResult(testResult: TestResult) {

		let testNode = this.__discoveredTestsMap.get(this.getNodeKey(testResult.uri.fsPath, testResult.testName));
		if (testNode) {
			testNode.testResult = testResult;
		}
		this.refresh(testNode);
	}
	private onDiscoverTestStart() {
		this._discoveredTests = [];
		this._discovering = true;
		this.refresh();
	}
	private onDicoveredTest(testNodeList: TestNode[]) {
		const previousMap = this.__discoveredTestsMap;
		this._discoveredTests = testNodeList && testNodeList.length > 0 ? testNodeList : [];

		this.__discoveredTestsMap = new Map();
		this._discoveredTests.forEach(x => {
			if (x.isTestSuite) {
				x.children.forEach(node => {
					this.registerNode(node, previousMap);
				});
				this.registerNode(x, previousMap);
			} else {
				this.registerNode(x, previousMap);
			}
		});

		this._discovering = false;
		this.refresh();
	}

	/**
	 * Registers a node in the lookup map, carrying over the result of the
	 * matching node from the previous discovery so that a refresh does not
	 * discard the outcome of tests that have already run.
	 */
	private registerNode(node: TestNode, previousMap: Map<string, TestNode>) {
		const key = this.getNodeKey(node.uri.fsPath, node.name);
		const previous = previousMap ? previousMap.get(key) : undefined;
		if (previous && previous.testResult && !node.testResult) {
			node.testResult = previous.testResult;
		}
		this.__discoveredTestsMap.set(key, node);
	}
	private onTestRunStarted(testNode: TestNode) {
		testNode ? this.setLoading(testNode) : this.setAlloading();
	}
	private setLoading(testNode: TestNode) {
		let tempNode = this.__discoveredTestsMap.get(this.getNodeKey(testNode.uri.fsPath, testNode.name));
		if (tempNode) {
			tempNode.setLoading();
		}
		this.refresh(tempNode);
	}
	private setAlloading() {
		this.discoveredTests.
			filter(s => s.isTestSuite).
			forEach(s => s.children.forEach(t => t.setLoading()));

		this.refresh();
	}
	private getNodeKey(uri: string, nodeName: string): string {
		return uri + "__" + nodeName;
	}
}

