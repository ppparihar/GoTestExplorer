
import vscode = require('vscode');
import { TestResult } from './testResult';
import { Icons } from './icons';
export class TestNode {
	private _testResult: TestResult;
	private _isLoading: boolean;
	constructor(
		public readonly name: string,
		public uri: vscode.Uri,
		private _children?: TestNode[]
	) { }
	get isTestSuite(): boolean {
		return this._children && this._children.length > 0;
	}
	get tooltip(): string {
		return `${this.name}`;
	}
	set testResult(testResult: TestResult) {
		this._testResult = testResult;
		this.loadingCompleted();
	}
	get testResult(): TestResult {
		return this._testResult;
	}
	get icon(): string {
		return this._isLoading ? Icons.loading :
			this.isTestSuite ? Icons.testSuit :
				!this.testResult ? Icons.test :
					this.testResult.result ? Icons.testPassed :
						Icons.testFailed
	}
	get children(): TestNode[] {
		return this._children;
	}
	setLoading() {
		this._isLoading = true;
	}
	loadingCompleted() {
		this._isLoading = false;
	}

}