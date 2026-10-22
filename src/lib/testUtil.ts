import cp = require('child_process');
import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import { getBinPathWithPreferredGopath, getBinPathFromEnvVar, envPath } from './goPath';
import { getCurrentGoPath, getTestEnvVars, getToolsGopath, LineBuffer } from './utils';
import { buildTargetArgs, resolveTestTimeout } from './testArgs';
import { RawTestResult } from '../rawTestResult';
import { GoTestJsonParser } from '../exec/goTestJsonParser';
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
		// The tool writes a JSON event per line, so the outcome of every
		// test is read from the stream rather than scraped from the text.
		let args: Array<string> = ['test', '-json', ...testconfig.flags];
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
			const parser = new GoTestJsonParser();
			const errBuf = new LineBuffer();

			// The output of the run is written as it arrives, so a long run
			// shows its progress.
			tp.stdout.on('data', chunk => {
				const parsed = parser.write(chunk.toString());
				parsed.output.forEach(line => outputChannel.appendLine(line));
				parsed.buildOutput.forEach(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));
			});

			// go test emits anything that is not part of the event stream on
			// stderr, which contains paths relative to the cwd.
			errBuf.onLine(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));
			errBuf.onDone(last => last && outputChannel.appendLine(expandFilePathInOutput(last, testconfig.dir)));

			tp.stderr.on('data', chunk => errBuf.append(chunk.toString()));

			tp.on('close', (code, signal) => {
				const parsed = parser.end();
				parsed.output.forEach(line => outputChannel.appendLine(line));
				parsed.buildOutput.forEach(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));

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

				const results = parser.results;
				// The build error comes before everything else the run
				// produced, so it leads the output.
				const output = results.buildOutput.concat(results.output);
				resolve(new RawTestResult(code === 0, output, results.failedTests.slice()));
			});

			runningTestProcesses.push(tp);

		}, err => {
			outputChannel.appendLine(`Error: ${testType} failed.`);
			outputChannel.appendLine(err);
			resolve(new RawTestResult(false, [], err));
		});
	});
}

/**
 * Makes the path of a Go file in a line of output absolute.
 *
 * The tool prints the path of a file relative to the directory it ran in.
 *
 * @param line the line of output.
 * @param cwd the directory the tool ran in.
 */
function expandFilePathInOutput(line: string, cwd: string): string {
	// The path group is matched non-greedily and cannot contain whitespace,
	// so a line holding two paths cannot bind the wrong one.
	const matches = line.match(/^\s*(\S+\.go):(\d+):/);
	if (matches && matches[1] && !path.isAbsolute(matches[1])) {
		return line.replace(matches[1], path.join(cwd, matches[1]));
	}
	return line;
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








