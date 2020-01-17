let toolsGopath: string;
import vscode = require('vscode');
import fs = require('fs');
import path = require('path');
import os = require('os');
import cp = require('child_process');
import { NearestNeighborDict, Node } from './avlTree';

export function getToolsGopath(useCache: boolean = true): string {
	if (!useCache || !toolsGopath) {
		toolsGopath = resolveToolsGopath();
	}

	return toolsGopath;
}

function resolveToolsGopath(): string {

	let toolsGopathForWorkspace = vscode.workspace.getConfiguration('go')['toolsGopath'] || '';

	// In case of single root, use resolvePath to resolve ~ and ${workspaceRoot}
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length <= 1) {
		return resolvePath(toolsGopathForWorkspace);
	}

	// In case of multi-root, resolve ~ and ignore ${workspaceRoot}
	if (toolsGopathForWorkspace.startsWith('~')) {
		toolsGopathForWorkspace = path.join(os.homedir(), toolsGopathForWorkspace.substr(1));
	}
	if (toolsGopathForWorkspace && toolsGopathForWorkspace.trim() && !/\${workspaceRoot}/.test(toolsGopathForWorkspace)) {
		return toolsGopathForWorkspace;
	}

	// If any of the folders in multi root have toolsGopath set, use it.
	for (let i = 0; i < vscode.workspace.workspaceFolders.length; i++) {
		let toolsGopath = <string>vscode.workspace.getConfiguration('go', vscode.workspace.workspaceFolders[i].uri).inspect('toolsGopath').workspaceFolderValue;
		toolsGopath = resolvePath(toolsGopath, vscode.workspace.workspaceFolders[i].uri.fsPath);
		if (toolsGopath) {
			return toolsGopath;
		}
	}
}
/**
 * Exapnds ~ to homedir in non-Windows platform and resolves ${workspaceRoot}
 */
export function resolvePath(inputPath: string, workspaceRoot?: string): string {
	if (!inputPath || !inputPath.trim()) return inputPath;

	if (!workspaceRoot && vscode.workspace.workspaceFolders) {
		if (vscode.workspace.workspaceFolders.length === 1) {
			workspaceRoot = vscode.workspace.rootPath;
		} else if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
			workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath;
		}
	}

	if (workspaceRoot) {
		inputPath = inputPath.replace(/\${workspaceRoot}/g, workspaceRoot).replace(/\${workspaceFolder}/g, workspaceRoot);
	}
	return resolveHomeDir(inputPath);
}

/**
 * Exapnds ~ to homedir in non-Windows platform
 */
export function resolveHomeDir(inputPath: string): string {
	if (!inputPath || !inputPath.trim()) return inputPath;
	return inputPath.startsWith('~') ? path.join(os.homedir(), inputPath.substr(1)) : inputPath;
}

export function killProcess(p: cp.ChildProcess) {
	if (p) {
		try {
			p.kill();
		} catch (e) {
			console.log('Error killing process: ' + e);

		}
	}
}

export function getTestEnvVars(config: vscode.WorkspaceConfiguration): any {
	const envVars = getToolsEnvVars();
	const testEnvConfig = config['testEnvVars'] || {};
	// removed  testEnvVars files
	Object.keys(testEnvConfig).forEach(key => envVars[key] = typeof testEnvConfig[key] === 'string' ? resolvePath(testEnvConfig[key]) : testEnvConfig[key]);
	

	return envVars;
}

export function getToolsEnvVars(): any {
	const config = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	const toolsEnvVars = config['toolsEnvVars'];

	const gopath = getCurrentGoPath();
	const envVars = Object.assign({}, process.env, gopath ? { GOPATH: gopath } : {});

	if (toolsEnvVars && typeof toolsEnvVars === 'object') {
		Object.keys(toolsEnvVars).forEach(key => envVars[key] = typeof toolsEnvVars[key] === 'string' ? resolvePath(toolsEnvVars[key]) : toolsEnvVars[key]);
	}

	// cgo expects go to be in the path
	const goroot: string = envVars['GOROOT'];
	let pathEnvVar: string;
	if (envVars.hasOwnProperty('PATH')) {
		pathEnvVar = 'PATH';
	} else if (process.platform === 'win32' && envVars.hasOwnProperty('Path')) {
		pathEnvVar = 'Path';
	}
	if (goroot && pathEnvVar && envVars[pathEnvVar] && (<string>envVars[pathEnvVar]).split(path.delimiter).indexOf(goroot) === -1) {
		envVars[pathEnvVar] += path.delimiter + path.join(goroot, 'bin');
	}

	return envVars;
}

export function stripBOM(s: string): string {
	if (s && s[0] === '\uFEFF') {
		s = s.substr(1);
	}
	return s;
}

export function parseEnvFile(path: string): { [key: string]: string } {
	const env: { [key: string]: any } = {};
	if (!path) {
		return env;
	}

	try {
		const buffer = stripBOM(fs.readFileSync(path, 'utf8'));
		buffer.split('\n').forEach(line => {
			const r = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
			if (r !== null) {
				let value = r[2] || '';
				if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
					value = value.replace(/\\n/gm, '\n');
				}
				env[r[1]] = value.replace(/(^['"]|['"]$)/g, '');
			}
		});
		return env;
	} catch (e) {
		throw new Error(`Cannot load environment variables from file ${path}`);
	}
}

export function getCurrentGoPath(workspaceUri?: vscode.Uri): string {

	const config = vscode.workspace.getConfiguration('go', workspaceUri);
	let currentRoot = workspaceUri ? workspaceUri.fsPath : vscode.workspace.rootPath;
	const configGopath = config['gopath'] ? resolvePath(config['gopath'], currentRoot) : '';
	return  (configGopath || process.env['GOPATH']);
}

export function promptForMissingTool(tool: string ){
    vscode.window.showInformationMessage(`${tool} is missing`)
}
export function getFileArchive(document: vscode.TextDocument): string {
	let fileContents = document.getText();
	return document.fileName + '\n' + Buffer.byteLength(fileContents, 'utf8') + '\n' + fileContents;
}

export function makeMemoizedByteOffsetConverter(buffer: Buffer): (byteOffset: number) => number {
	let defaultValue = new Node<number, number>(0, 0); // 0 bytes will always be 0 characters
	let memo = new NearestNeighborDict(defaultValue, NearestNeighborDict.NUMERIC_DISTANCE_FUNCTION);
	return (byteOffset: number) => {
		let nearest = memo.getNearest(byteOffset);
		let byteDelta = byteOffset - nearest.key;

		if (byteDelta === 0)
			return nearest.value;

		let charDelta: number;
		if (byteDelta > 0)
			charDelta = buffer.toString('utf8', nearest.key, byteOffset).length;
		else
			charDelta = -buffer.toString('utf8', byteOffset, nearest.key).length;

		memo.insert(byteOffset, nearest.value + charDelta);
		return nearest.value + charDelta;
	};
}
export class LineBuffer {
	private buf: string = '';
	private lineListeners: { (line: string): void; }[] = [];
	private lastListeners: { (last: string): void; }[] = [];

	append(chunk: string) {
		this.buf += chunk;
		do {
			const idx = this.buf.indexOf('\n');
			if (idx === -1) {
				break;
			}

			this.fireLine(this.buf.substring(0, idx));
			this.buf = this.buf.substring(idx + 1);
		} while (true);
	}

	done() {
		this.fireDone(this.buf !== '' ? this.buf : null);
	}

	private fireLine(line: string) {
		this.lineListeners.forEach(listener => listener(line));
	}

	private fireDone(last: string) {
		this.lastListeners.forEach(listener => listener(last));
	}

	onLine(listener: (line: string) => void) {
		this.lineListeners.push(listener);
	}

	onDone(listener: (last: string) => void) {
		this.lastListeners.push(listener);
	}
}
