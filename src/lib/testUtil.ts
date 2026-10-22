import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  getBinPathWithPreferredGopath,
  getBinPathFromEnvVar,
  envPath,
  resolveHomeDir,
} from './goPath';
import { getCurrentGoPath, getTestEnvVars, getToolsGopath, LineBuffer } from './utils';
import { buildTargetArgs } from './testArgs';
import { testOutput } from './testOutput';
import { RunSettings, goBinary, goPath } from './settings';
import { RawTestResult } from '../rawTestResult';
import { FinishedTest, GoTestJsonParser } from '../exec/goTestJsonParser';
//const testSuiteMethodRegex = /^\(([^)]+)\)\.(Test.*)$/;
const sendSignal = 'SIGKILL';

/**
 *  testProcesses holds a list of currently running test processes.
 */
const runningTestProcesses: cp.ChildProcess[] = [];

/**
 * Stops every test run that is in flight.
 *
 * The whole process tree is killed, not just the `go` process: the tool runs
 * the test binary as a child, and that binary would keep running — and keep
 * holding the build cache and the ports it needs — if only its parent were
 * killed.
 *
 * @returns the number of runs that were stopped.
 */
export function cancelRunningTests(): number {
  // The list is copied because a process that is killed is removed from it.
  const processes = runningTestProcesses.slice();
  processes.forEach((child) => killProcessTree(child));
  return processes.length;
}

/**
 * Kills a process and everything it started.
 *
 * @param child the process to kill.
 * @param signal the signal to send.
 */
export function killProcessTree(child: cp.ChildProcess, signal: NodeJS.Signals = sendSignal): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    // Windows has no process groups, so the tree is walked by taskkill.
    try {
      cp.execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } catch {
      // The process is gone already, or could not be killed.
    }
    return;
  }
  try {
    // The negative pid addresses the whole process group. The child leads
    // its own group, because it was spawned detached.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process is gone already.
    }
  }
}

/**
 * Input to goTest.
 */
/**
 * A file that holds tests.
 */
export interface TestFile {
  /**
   * The file the tests are declared in.
   */
  uri: vscode.Uri;
  /**
   * The name of the file, which is also the name of its node in the tree.
   */
  name: string;
  /**
   * The names of the tests the file holds.
   */
  functions: string[];
}

/**
 * A package that a run tests.
 */
export interface TestPackage {
  /**
   * The import path of the package, which is how the tool reports it.
   */
  importPath: string;
  /**
   * The path of the package, relative to the directory the run starts in.
   */
  path: string;
  /**
   * The files of the package that hold tests.
   */
  files: TestFile[];
}

export interface TestConfig {
  /**
   * The working directory for `go test`.
   */
  dir: string;
  /**
   * The settings that decide how the run is carried out.
   */
  settings: RunSettings;
  /**
   * Test flags to override the testFlags and buildFlags from the settings.
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

  /**
   * The packages the run tests, when it tests more than one.
   *
   * A run that tests several packages uses one process for all of them, so
   * that the packages are compiled once. There is no filter on the names of
   * the tests in that case: a filter would apply to every package of the
   * run, and would keep a test that was not asked for from running in a
   * package where it was asked for.
   */
  packages?: TestPackage[];

  /**
   * Called as soon as a test of the run has finished, while the rest of the
   * run is still going.
   */
  onTestFinished?: (test: FinishedTest) => void;
}

export function getBinPath(tool: string): string {
  return getBinPathWithPreferredGopath(
    tool,
    tool === 'go' ? [] : [getToolsGopath(), getCurrentGoPath()],
    vscode.workspace.getConfiguration('go', null).get('alternateTools'),
  );
}

/**
 * The path of the go binary that a run uses.
 *
 * The user can point at a binary of their own, and can set a GOPATH, in
 * which case the binary is looked for in the bin folder of that GOPATH.
 * When neither is set, the binary is looked for the way it was before: the
 * one the Go extension names, the one in GOROOT, and the one on the PATH.
 *
 * @param resource the file the settings are resolved against.
 */
export function getGoBinaryPath(resource?: vscode.Uri): string {
  const binary = goBinary(resource);
  if (binary) {
    return resolveHomeDir(binary);
  }
  const gopath = goPath(resource);
  if (gopath) {
    const fromGopath = getBinPathFromEnvVar('go', resolveHomeDir(gopath), true);
    if (fromGopath) {
      return fromGopath;
    }
  }
  return getBinPath('go');
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
    } catch {
      return false;
    }
  }
  return getBinPathFromEnvVar(tool, envPath, false) !== null;
}

/**
 * Input to goTest.
 */
export function runGoTest(
  testconfig: TestConfig,
  token?: vscode.CancellationToken,
): Promise<RawTestResult> {
  return new Promise<RawTestResult>((resolve) => {
    // We do not want to clear it if tests are already running, as that could
    // lose valuable output.
    if (runningTestProcesses.length < 1) {
      testOutput.clear();
    }

    if (!testconfig.background) {
      testOutput.show(true);
    }

    const buildTags: string = testconfig.settings.buildTags;
    const testFlags: Array<string> = testconfig.settings.testFlags || [];
    // The tool writes a JSON event per line, so the outcome of every
    // test is read from the stream rather than scraped from the text.
    const args: Array<string> = ['test', '-json', ...testconfig.flags];
    const testType: string = testconfig.isBenchmark ? 'Benchmarks' : 'Tests';

    // Ends the run as a failure, whatever went wrong while it was being set up.
    const failRun = (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      testOutput.writeLine(`Error: ${testType} failed.`);
      testOutput.writeLine(err.message);
      resolve(new RawTestResult(false, [], [], err));
    };

    if (testconfig.isBenchmark) {
      args.push('-benchmem', '-run=^$');
    } else {
      args.push('-timeout', testconfig.settings.timeout);
    }
    if (buildTags && testconfig.flags.indexOf('-tags') === -1) {
      args.push('-tags', buildTags);
    }

    testFlags.forEach((flag) => args.push(flag));

    const testEnvVars = getTestEnvVars(
      testconfig.settings.envFile,
      testconfig.settings.env,
      testconfig.testUri,
    );
    const goRuntimePath = getGoBinaryPath(testconfig.testUri);

    if (!goRuntimePath) {
      const message = 'Cannot find "go" binary. Update PATH or GOROOT appropriately';
      vscode.window.showInformationMessage(message);
      testOutput.writeLine(`Error: ${testType} failed.`);
      testOutput.writeLine(message);
      resolve(new RawTestResult(false, [], [], new Error(message)));
      return;
    }

    // Append the package name to args to enable running tests in symlinked directories
    // let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), testconfig.dir);
    // if (currentGoWorkspace && !testconfig.includeSubDirectories) {
    // 	args.push(testconfig.dir.substr(currentGoWorkspace.length + 1));
    // }

    Promise.resolve(targetArgs(testconfig))
      .then((targets) => {
        const outTargets = args.slice(0);
        if (targets.length > 4) {
          outTargets.push('<long arguments omitted>');
        } else {
          outTargets.push(...targets);
        }
        testOutput.writeLine(['Running tool:', goRuntimePath, ...outTargets].join(' '));
        // The timeout that is in force is shown, so a run that fails
        // because of it can be told apart from a run that failed for
        // another reason.
        if (!testconfig.isBenchmark) {
          testOutput.writeLine(`Timeout: ${testconfig.settings.timeout}`);
        }
        testOutput.writeLine('');

        // A loop, not a spread: a spread of a very long list overflows the stack.
        targets.forEach((target) => args.push(target));

        // The child leads its own process group, so the whole tree can be
        // killed when the run is cancelled. A detached child outlives the
        // extension host, so the runs are killed when the window closes.
        const detached = process.platform !== 'win32';
        const tp = cp.spawn(goRuntimePath, args, {
          env: testEnvVars,
          cwd: testconfig.dir,
          detached,
        });
        // The process may fail to start (the tool is missing, or the arguments
        // are longer than the system accepts). The run then ends as a failure
        // instead of waiting for a close that never comes.
        tp.on('error', (error) => {
          const index = runningTestProcesses.indexOf(tp, 0);
          if (index > -1) {
            runningTestProcesses.splice(index, 1);
          }
          failRun(error);
        });
        const parser = new GoTestJsonParser(testconfig.onTestFinished);
        const errBuf = new LineBuffer();

        if (token) {
          if (token.isCancellationRequested) {
            killProcessTree(tp);
          } else {
            token.onCancellationRequested(() => killProcessTree(tp));
          }
        }

        // The output of the run is written as it arrives, so a long run
        // shows its progress.
        tp.stdout.on('data', (chunk) => {
          const parsed = parser.write(chunk.toString());
          parsed.output.forEach((line) => testOutput.writeLine(line));
          parsed.buildOutput.forEach((line) =>
            testOutput.writeLine(expandFilePathInOutputLine(line, testconfig.dir)),
          );
        });

        // go test emits anything that is not part of the event stream on
        // stderr, which contains paths relative to the cwd.
        errBuf.onLine((line) =>
          testOutput.writeLine(expandFilePathInOutputLine(line, testconfig.dir)),
        );
        errBuf.onDone(
          (last) => last && testOutput.writeLine(expandFilePathInOutputLine(last, testconfig.dir)),
        );

        tp.stderr.on('data', (chunk) => errBuf.append(chunk.toString()));

        tp.on('close', (code, signal) => {
          const parsed = parser.end();
          parsed.output.forEach((line) => testOutput.writeLine(line));
          parsed.buildOutput.forEach((line) =>
            testOutput.writeLine(expandFilePathInOutputLine(line, testconfig.dir)),
          );

          errBuf.done();

          if (code) {
            testOutput.writeLine(`Error: ${testType} failed.`);
          } else if (signal === sendSignal) {
            testOutput.writeLine(`Error: ${testType} terminated by user.`);
          } else {
            testOutput.writeLine(`Success: ${testType} passed.`);
          }

          const index = runningTestProcesses.indexOf(tp, 0);
          if (index > -1) {
            runningTestProcesses.splice(index, 1);
          }

          const results = parser.results;
          // The build error comes before everything else the run
          // produced, so it leads the output.
          const output = results.buildOutput.concat(results.output);
          const failedTests: string[] = [];
          results.packages.forEach((pkg) => failedTests.push(...pkg.failedTests));
          resolve(new RawTestResult(code === 0, output, failedTests, undefined, results.packages));
        });

        runningTestProcesses.push(tp);
      })
      .catch((error) => failRun(error));
  });
}

/**
 * The path of a Go file in a line of output, with the line number after it.
 */
const goFileInOutput = /(\S+\.go):(\d+):/g;

/**
 * Makes the path of a Go file in a line of output absolute.
 *
 * The tool prints the path of a file relative to the directory it ran in.
 *
 * The line is scanned once, and every path in it is expanded where it
 * stands. The earlier implementation replaced the first occurrence of the
 * path in the line, which was not always the path of the message: a line
 * that names a file before the message expanded the wrong one.
 *
 * @param line the line of output.
 * @param cwd the directory the tool ran in.
 * @returns the line with the paths of Go files made absolute.
 */
export function expandFilePathInOutputLine(line: string, cwd: string): string {
  return line.replace(goFileInOutput, (match, file: string, lineNumber: string) => {
    if (path.isAbsolute(file)) {
      return match;
    }
    return path.join(cwd, file) + ':' + lineNumber + ':';
  });
}

/**
 * Get the test target arguments.
 *
 * A run that tests several packages names them, so that one process tests
 * them all. A run that tests one package names the tests to run, so that the
 * other tests of the package are left alone.
 *
 * @param testconfig Configuration for the Go extension.
 */
function targetArgs(testconfig: TestConfig): Thenable<Array<string>> {
  if (testconfig.packages && testconfig.packages.length > 0) {
    return Promise.resolve(
      testconfig.packages.map((pkg) => (pkg.path === '' ? '.' : './' + pkg.path)),
    );
  }
  return Promise.resolve(
    buildTargetArgs({
      functions: testconfig.functions,
      isBenchmark: testconfig.isBenchmark,
    }),
  );
}
