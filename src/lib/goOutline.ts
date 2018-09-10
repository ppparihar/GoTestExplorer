

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath } from './testUtil';
import { killProcess, getToolsEnvVars, promptForMissingTool, getFileArchive, makeMemoizedByteOffsetConverter } from './utils';
//import { getBinPath, getFileArchive, getToolsEnvVars, killProcess, makeMemoizedByteOffsetConverter } from './util';


// Keep in sync with https://github.com/ramya-rao-a/go-outline
export interface GoOutlineRange {
	start: number;
	end: number;
}

export interface GoOutlineDeclaration {
	label: string;
	type: string;
	receiverType?: string;
	icon?: string; // icon class or null to use the default images based on the type
	start: number;
	end: number;
	children?: GoOutlineDeclaration[];
	signature?: GoOutlineRange;
	comment?: GoOutlineRange;
}

export interface GoOutlineOptions {
	/**
	 * Path of the file for which outline is needed
	 */
	fileName: string;

	/**
	 * If true, then the file will be parsed only till imports are collected
	 */
	importsOnly?: boolean;

	/**
	 * Document to be parsed. If not provided, saved contents of the given fileName is used
	 */
	document?: vscode.TextDocument;
}

export function documentSymbols(options: GoOutlineOptions, token: vscode.CancellationToken): Promise<GoOutlineDeclaration[]> {
	return new Promise<GoOutlineDeclaration[]>((resolve, reject) => {
		let gooutline = getBinPath('go-outline');
		let gooutlineFlags = ['-f', options.fileName];
		if (options.importsOnly) {
			gooutlineFlags.push('-imports-only');
		}
		if (options.document) {
			gooutlineFlags.push('-modified');
		}

		let p: cp.ChildProcess;
		if (token) {
			token.onCancellationRequested(() => killProcess(p));
		}

		// Spawn `go-outline` process
		p = cp.execFile(gooutline, gooutlineFlags, { env: getToolsEnvVars() }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('go-outline');
				}
				if (stderr && stderr.startsWith('flag provided but not defined: ')) {
				//	promptForUpdatingTool('go-outline');
					if (stderr.startsWith('flag provided but not defined: -imports-only')) {
						options.importsOnly = false;
					}
					if (stderr.startsWith('flag provided but not defined: -modified')) {
						options.document = null;
					}
					p = null;
					return documentSymbols(options, token).then(results => {
						return resolve(results);
					});
				}
				if (err) return resolve(null);
				let result = stdout.toString();
				let decls = <GoOutlineDeclaration[]>JSON.parse(result);
				return resolve(decls);
			} catch (e) {
				reject(e);
			}
		});
		if (options.document && p.pid) {
			p.stdin.end(getFileArchive(options.document));
		}
	});
}

export class GoDocumentSymbolProvider  {

	private goKindToCodeKind: { [key: string]: vscode.SymbolKind } = {
		'package': vscode.SymbolKind.Package,
		'import': vscode.SymbolKind.Namespace,
		'variable': vscode.SymbolKind.Variable,
		'type': vscode.SymbolKind.Interface,
		'function': vscode.SymbolKind.Function
	};

	private convertToCodeSymbols(
		uri: vscode.Uri,
		document: vscode.TextDocument,
		decls: GoOutlineDeclaration[],
		symbols: vscode.SymbolInformation[],
		containerName: string,
		byteOffsetToDocumentOffset: (byteOffset: number) => number
		): void {

		let gotoSymbolConfig = vscode.workspace.getConfiguration('go', uri)['gotoSymbol'];
		let includeImports = gotoSymbolConfig ? gotoSymbolConfig['includeImports'] : false;

		(decls || []).forEach(decl => {
			if (!includeImports && decl.type === 'import') return;

			let label = decl.label;

			if (label === '_' && decl.type === 'variable') return;

			if (decl.receiverType) {
				label = '(' + decl.receiverType + ').' + label;
			}

			let start = byteOffsetToDocumentOffset(decl.start - 1);
			let end = byteOffsetToDocumentOffset(decl.end - 1);

			let symbolInfo = new vscode.SymbolInformation(
				label,
				this.goKindToCodeKind[decl.type],
			//	null,
				new vscode.Range(document.positionAt(start), document.positionAt(end)),
				uri,
				containerName);
			symbols.push(symbolInfo);
			if (decl.children) {
				this.convertToCodeSymbols(uri,document, decl.children, symbols, decl.label
					, byteOffsetToDocumentOffset
				);
			}
		});
	}

	public provideDocumentSymbols( uri :vscode.Uri, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
		let options = { fileName: uri.fsPath };
		return documentSymbols(options, token).then(async decls => {
			let symbols: vscode.SymbolInformation[] = [];
			//let document: vscode.TextDocument
			let document  = await vscode.workspace.openTextDocument(uri)
			this.convertToCodeSymbols(uri,document, decls, symbols, '' 
			, makeMemoizedByteOffsetConverter(new Buffer(document.getText()))
		);
			return symbols;
		});
	}
}
