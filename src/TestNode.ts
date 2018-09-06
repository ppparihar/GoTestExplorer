
import vscode = require('vscode');
export class TestNode {
	constructor(public readonly label: string, public uri: vscode.Uri, public icon: string, public readonly isTestsuit?: boolean, public symbol?: vscode.SymbolInformation) {
		//super(label, collapsibleState);
	}
	get tooltip(): string {
		return `${this.label}`;
	}
	
}