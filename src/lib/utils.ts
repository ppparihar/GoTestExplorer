let toolsGopath: string;
import * as vscode from 'vscode';
import path = require('path');
import os = require('os');
import cp = require('child_process');
import { parseEnvFile, resolveHomeDir } from './goPath';

export function getToolsGopath(useCache: boolean = true): string {
	if (!useCache || !toolsGopath) {
		toolsGopath = resolveToolsGopath();
	}

	return toolsGopath;
}

function resolveToolsGopath(): string | undefined {

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
	return undefined;
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
export function killProcess(p: cp.ChildProcess) {
	if (p) {
		try {
			p.kill();
		} catch (e) {
			console.log('Error killing process: ' + e);

		}
	}
}

export function getTestEnvVars(config: vscode.WorkspaceConfiguration, workspaceUri?: vscode.Uri): any {
	const envVars = getToolsEnvVars(workspaceUri);
	const testEnvConfig = config['testEnvVars'] || {};

	let fileEnv: { [key: string]: any } = {};
	let testEnvFile = config['testEnvFile'];
	if (testEnvFile) {
		testEnvFile = resolvePath(testEnvFile);
		try {
			fileEnv = parseEnvFile(testEnvFile);
		} catch (e) {
			console.log(e);
		}
	}

	Object.keys(fileEnv).forEach(key => envVars[key] = typeof fileEnv[key] === 'string' ? resolvePath(fileEnv[key]) : fileEnv[key]);
	Object.keys(testEnvConfig).forEach(key => envVars[key] = typeof testEnvConfig[key] === 'string' ? resolvePath(testEnvConfig[key]) : testEnvConfig[key]);

	return envVars;
}


/**
 * Builds the environment for a tool invocation.
 *
 * @param workspaceUri the resource the configuration should be resolved
 * against. When omitted the focused editor is used, which is the right
 * default for editor-driven actions but the wrong one for a test run — a test
 * run must use the settings of the file under test, not of whichever file
 * happens to be open.
 */
export function getToolsEnvVars(workspaceUri?: vscode.Uri): any {
	const resource = workspaceUri ?? (vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	const config = vscode.workspace.getConfiguration('go', resource);
	const toolsEnvVars = config['toolsEnvVars'];

	const gopath = getCurrentGoPath(workspaceUri);
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

export function getCurrentGoPath(workspaceUri?: vscode.Uri): string {

	const config = vscode.workspace.getConfiguration('go', workspaceUri);
	let currentRoot = workspaceUri ? workspaceUri.fsPath : vscode.workspace.rootPath;
	const configGopath = config['gopath'] ? resolvePath(config['gopath'], currentRoot) : '';
	return  (configGopath || process.env['GOPATH']);
}

const warnedTools = new Set<string>();

/**
 * Reports a missing tool to the user, at most once per tool.
 *
 * A missing tool is typically discovered once per file, so reporting every
 * time produces a burst of identical notifications.
 */
export function promptForMissingTool(tool: string) {
	if (warnedTools.has(tool)) {
		return;
	}
	warnedTools.add(tool);
	vscode.window.showInformationMessage(`${tool} is missing`);
}

/**
 * Clears the record of already-reported missing tools.
 */
export function resetMissingToolWarnings(): void {
	warnedTools.clear();
}
/**
 * Splits a stream of text into lines.
 *
 * The chunks are kept in an array and a cursor walks them, so the work is
 * proportional to the number of bytes seen. The earlier implementation kept
 * the text that was left in a string and cut it back for every line, which
 * copied the rest of the stream once per line.
 */
export class LineBuffer {
	private readonly chunks: string[] = [];
	private scanChunk = 0;
	private scanPos = 0;
	private pending = '';
	private readonly lineListeners: ((line: string) => void)[] = [];
	private readonly lastListeners: ((last: string) => void)[] = [];

	append(chunk: string) {
		if (chunk.length === 0) {
			return;
		}
		this.chunks.push(chunk);
		this.scan();
	}

	done() {
		const last = this.pending !== '' ? this.pending : null;
		this.pending = '';
		this.fireDone(last);
	}

	/**
	 * Reads the lines that the chunks hold.
	 */
	private scan() {
		while (this.scanChunk < this.chunks.length) {
			const chunk = this.chunks[this.scanChunk];
			const index = chunk.indexOf('\n', this.scanPos);
			if (index === -1) {
				// The chunk holds no line ending, so it is part of the line
				// that is being read.
				this.pending += chunk.substring(this.scanPos);
				this.scanPos = chunk.length;
				this.scanChunk++;
				continue;
			}
			const text = chunk.substring(this.scanPos, index);
			this.fireLine(this.pending === '' ? text : this.pending + text);
			this.pending = '';
			this.scanPos = index + 1;
			if (this.scanPos >= chunk.length) {
				this.scanChunk++;
				this.scanPos = 0;
			}
		}
		this.compact();
	}

	/**
	 * Drops the chunks that have been read, so the array does not grow for
	 * the whole life of the buffer.
	 */
	private compact() {
		if (this.scanChunk === 0) {
			return;
		}
		if (this.scanChunk >= this.chunks.length) {
			// Every chunk has been read, so the next one starts at the
			// beginning of the stream again.
			this.chunks.length = 0;
			this.scanChunk = 0;
			this.scanPos = 0;
			return;
		}
		if (this.scanChunk * 2 >= this.chunks.length) {
			this.chunks.splice(0, this.scanChunk);
			this.scanChunk = 0;
		}
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
