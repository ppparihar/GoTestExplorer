import * as vscode from 'vscode';
export interface Entry {
	name: string;
	uri: vscode.Uri;
	type: vscode.FileType;
}