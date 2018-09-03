import cp = require('child_process');
import vscode = require('vscode');
import path = require('path');
import os = require('os');
import util = require('util');
import { GoDocumentSymbolProvider } from './goOutline';
import { getBinPathWithPreferredGopath } from './goPath';
import { resolvePath, getCurrentGoPath, getTestEnvVars, LineBuffer } from './utils';
const testSuiteMethodRegex = /^\(([^)]+)\)\.(Test.*)$/;
const sendSignal = 'SIGKILL';

/**
 *  testProcesses holds a list of currently running test processes.
 */
const runningTestProcesses: cp.ChildProcess[] = [];


let toolsGopath :string;
const outputChannel = vscode.window.createOutputChannel('Go Test Explorer');

/**
 * Input to goTest.
 */
export interface TestConfig {
	/**
	 * The working directory for `go test`.
	 */
	dir: string;
	/**
	 * Configuration for the Go extension
	 */
	goConfig: vscode.WorkspaceConfiguration;
	/**
	 * Test flags to override the testFlags and buildFlags from goConfig.
	 */
	flags: string[];
	/**
	 * Specific function names to test.
	 */
	functions?: string[];
	/**
	 * Test was not requested explicitly. The output should not appear in the UI.
	 */
	background?: boolean;
	/**
	 * Run all tests from all sub directories under `dir`
	 */
	includeSubDirectories?: boolean;
	/**
	 * Whether this is a benchmark.
	 */
	isBenchmark?: boolean;
}

export function getTestFunctions(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(uri, token)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function
				&& (sym.name.startsWith('Test') || sym.name.startsWith('Example') || testSuiteMethodRegex.test(sym.name))
			)
		);
}
export function getBinPath(tool: string): string {
	return getBinPathWithPreferredGopath(tool, tool === 'go' ? [] : [getToolsGopath(), getCurrentGoPath()], vscode.workspace.getConfiguration('go', null).get('alternateTools'));
}
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
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function goTest(testconfig: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {

		// We do not want to clear it if tests are already running, as that could
		// lose valuable output.
		if (runningTestProcesses.length < 1) {
			outputChannel.clear();
		}

		if (!testconfig.background) {
			outputChannel.show(true);
		}

		let buildTags: string = testconfig.goConfig['buildTags'];
		let args: Array<string> = ['test', ...testconfig.flags];
		let testType: string = testconfig.isBenchmark ? 'Benchmarks' : 'Tests';

		if (testconfig.isBenchmark) {
			args.push('-benchmem', '-run=^$');
		} else {
			args.push('-timeout', testconfig.goConfig['testTimeout']);
		}
		if (buildTags && testconfig.flags.indexOf('-tags') === -1) {
			args.push('-tags', buildTags);
		}

		let testEnvVars = getTestEnvVars(testconfig.goConfig);
		let goRuntimePath = getBinPath('go');

		if (!goRuntimePath) {
			vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
			return Promise.resolve();
		}

		// Append the package name to args to enable running tests in symlinked directories
		// let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), testconfig.dir);
		// if (currentGoWorkspace && !testconfig.includeSubDirectories) {
		// 	args.push(testconfig.dir.substr(currentGoWorkspace.length + 1));
		// }

		targetArgs(testconfig).then(targets => {
			let outTargets = args.slice(0);
			if (targets.length > 4) {
				outTargets.push('<long arguments omitted>');
			} else {
				outTargets.push(...targets);
			}
			outputChannel.appendLine(['Running tool:', goRuntimePath, ...outTargets].join(' '));
			outputChannel.appendLine('');

			args.push(...targets);

			let tp = cp.spawn(goRuntimePath, args, { env: testEnvVars, cwd: testconfig.dir });
			const outBuf = new LineBuffer();
			const errBuf = new LineBuffer();

			const packageResultLineRE = /^(ok|FAIL)[ \t]+(.+?)[ \t]+([0-9\.]+s|\(cached\))/; // 1=ok/FAIL, 2=package, 3=time/(cached)
			const testResultLines: string[] = [];

			const processTestResultLine = (line: string) => {
				testResultLines.push(line);
				const result = line.match(packageResultLineRE);
				if (result) {
				//if (result && currentGoWorkspace) {
					//const packageNameArr = result[2].split('/');
					//const baseDir = path.join(currentGoWorkspace, ...packageNameArr);
					testResultLines.forEach(line => outputChannel.appendLine(expandFilePathInOutput(line, "baseDir")));
					testResultLines.splice(0);
				}
			};

			// go test emits test results on stdout, which contain file names relative to the package under test
			outBuf.onLine(line => processTestResultLine(line));
			outBuf.onDone(last => {
				if (last) processTestResultLine(last);

				// If there are any remaining test result lines, emit them to the output channel.
				if (testResultLines.length > 0) {
					testResultLines.forEach(line => outputChannel.appendLine(line));
				}
			});

			// go test emits build errors on stderr, which contain paths relative to the cwd
			errBuf.onLine(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));
			errBuf.onDone(last => last && outputChannel.appendLine(expandFilePathInOutput(last, testconfig.dir)));

			tp.stdout.on('data', chunk => outBuf.append(chunk.toString()));
			tp.stderr.on('data', chunk => errBuf.append(chunk.toString()));

		

			tp.on('close', (code, signal) => {
				outBuf.done();
				errBuf.done();

				if (code) {
					outputChannel.appendLine(`Error: ${testType} failed.`);
				} else if (signal === sendSignal) {
					outputChannel.appendLine(`Error: ${testType} terminated by user.`);
				} else {
					outputChannel.appendLine(`Success: ${testType} passed.`);
				}

				let index = runningTestProcesses.indexOf(tp, 0);
				if (index > -1) {
					runningTestProcesses.splice(index, 1);
				}



				resolve(code === 0);
			});

			runningTestProcesses.push(tp);

		}, err => {
			outputChannel.appendLine(`Error: ${testType} failed.`);
			outputChannel.appendLine(err);
			resolve(false);
		});
	});
}

function expandFilePathInOutput(output: string, cwd: string): string {
	let lines = output.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let matches = lines[i].match(/^\s*(.+.go):(\d+):/);
		if (matches && matches[1] && !path.isAbsolute(matches[1])) {
			lines[i] = lines[i].replace(matches[1], path.join(cwd, matches[1]));
		}
	}
	return lines.join('\n');
}

/**
 * Get the test target arguments.
 *
 * @param testconfig Configuration for the Go extension.
 */
function targetArgs(testconfig: TestConfig): Thenable<Array<string>> {
	if (testconfig.functions) {
		let params: string[] = [];
		if (testconfig.isBenchmark) {
			params = ['-bench', util.format('^%s$', testconfig.functions.join('|'))];
		} else {
			let testFunctions = testconfig.functions;
			
			if (testFunctions.length > 0) {
				params = params.concat(['-run', util.format('^%s$', testFunctions.join('|'))]);
			}
			
		}
		return Promise.resolve(params);
	}
	let params: string[] = [];
	if (testconfig.isBenchmark) {
		params = ['-bench', '.'];
	} 
	return Promise.resolve(params);
}








