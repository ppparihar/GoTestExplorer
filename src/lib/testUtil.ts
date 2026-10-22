import cp = require('child_process');
import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import { getBinPathWithPreferredGopath, getBinPathFromEnvVar, envPath } from './goPath';
import { getCurrentGoPath, getTestEnvVars, getToolsGopath, LineBuffer } from './utils';
import { buildTargetArgs, resolveTestTimeout } from './testArgs';
import { RawTestResult } from '../rawTestResult';
//const testSuiteMethodRegex = /^\(([^)]+)\)\.(Test.*)$/;
const sendSignal = 'SIGKILL';

/**
 *  testProcesses holds a list of currently running test processes.
 */
const runningTestProcesses: cp.ChildProcess[] = [];


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

	testUri: vscode.Uri;

	testName: string;
}

export function getBinPath(tool: string): string {
	return getBinPathWithPreferredGopath(tool, tool === 'go' ? [] : [getToolsGopath(), getCurrentGoPath()], vscode.workspace.getConfiguration('go', null).get('alternateTools'));
}

/**
 * Reports whether a tool can actually be executed.
 *
 * {@link getBinPath} falls back to returning the bare tool name when it
 * cannot find the binary, so a truthy result is not enough to conclude the
 * tool is installed.
 */
export function isToolAvailable(tool: string): boolean {
	const binPath = getBinPath(tool);
	if (!binPath) {
		return false;
	}
	if (path.isAbsolute(binPath)) {
		try {
			return fs.statSync(binPath).isFile();
		} catch (e) {
			return false;
		}
	}
	return getBinPathFromEnvVar(tool, envPath, false) !== null;
}

/**
 * Input to goTest.
 */
export function runGoTest(testconfig: TestConfig): Promise<RawTestResult> {
	return new Promise<RawTestResult>((resolve, reject) => {

		// We do not want to clear it if tests are already running, as that could
		// lose valuable output.
		if (runningTestProcesses.length < 1) {
			outputChannel.clear();
		}

		if (!testconfig.background) {
			outputChannel.show(true);
		}

		let buildTags: string = testconfig.goConfig['buildTags'];
		let testFlags: Array<string> = testconfig.goConfig['testFlags'] || [];
		let args: Array<string> = ['test', ...testconfig.flags];
		let testType: string = testconfig.isBenchmark ? 'Benchmarks' : 'Tests';

		if (testconfig.isBenchmark) {
			args.push('-benchmem', '-run=^$');
		} else {
			args.push('-timeout', resolveTestTimeout(testconfig.goConfig['testTimeout']));
		}
		if (buildTags && testconfig.flags.indexOf('-tags') === -1) {
			args.push('-tags', buildTags);
		}
		
		testFlags.forEach((flag)=> args.push(flag));

		let testEnvVars = getTestEnvVars(testconfig.goConfig, testconfig.testUri);
		let goRuntimePath = getBinPath('go');

		if (!goRuntimePath) {
			const message = 'Cannot find "go" binary. Update PATH or GOROOT appropriately';
			vscode.window.showInformationMessage(message);
			outputChannel.appendLine(`Error: ${testType} failed.`);
			outputChannel.appendLine(message);
			resolve(new RawTestResult(false, [], [], new Error(message)));
			return;
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

			const packageResultLineRE = /^(--- FAIL:)[ \t]+(.+?)[ \t]+(\([0-9\.]+s\)|\(cached\))/; // 1=ok/FAIL, 2=package, 3=time/(cached)
			//const packageResultLineRE = /^(ok|FAIL)[ \t]+(.+?)[ \t]+([0-9\.]+s|\(cached\))/; // 1=ok/FAIL, 2=package, 3=time/(cached)
			const testResultLines: string[] = [];
			const failedTests: string[] = [];
			const processTestResultLine = (line: string) => {
				testResultLines.push(line);
				const result = line.match(packageResultLineRE);
				if (result) {
					failedTests.push(result[2]);
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



				resolve(new RawTestResult(code === 0, testResultLines, failedTests));
			});

			runningTestProcesses.push(tp);

		}, err => {
			outputChannel.appendLine(`Error: ${testType} failed.`);
			outputChannel.appendLine(err);
			resolve(new RawTestResult(false, [], err));
		});
	});
}

function expandFilePathInOutput(output: string, cwd: string): string {
	let lines = output.split('\n');
	for (let i = 0; i < lines.length; i++) {
		// The path group is matched non-greedily and cannot contain whitespace,
		// so a line holding two paths cannot bind the wrong one.
		let matches = lines[i].match(/^\s*(\S+\.go):(\d+):/);
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
	return Promise.resolve(buildTargetArgs({
		functions: testconfig.functions,
		isBenchmark: testconfig.isBenchmark
	}));
}








