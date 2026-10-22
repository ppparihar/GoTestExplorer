/**
 * A parser for the event stream that `go test -json` writes.
 *
 * The tool writes one JSON object per line. Every object has an `Action`,
 * and the actions that matter for a test run are:
 *
 * - `run`, `pass`, `fail`, `skip` — the lifecycle of a single test. The
 *   `Test` field holds the test name, and a subtest is named `Parent/Sub`.
 * - `output` — the text a test produced, in `Output`. A test's own output
 *   carries its name in `Test`; output that belongs to no test does not.
 * - `build-output`, `build-fail` — a package that did not compile. The
 *   paths in a build error are relative to the directory the tool ran in.
 * - `fail` without a `Test` — the package failed.
 *
 * The tool also writes the ordinary test output, so the result of a run can
 * be shown to the user without parsing the text.
 */

/** A single event from `go test -json`. */
export interface GoTestEvent {
  /** What happened: `start`, `run`, `pass`, `fail`, `skip`, `output`, `build-output` or `build-fail`. */
  readonly Action: string;
  /** The package the event belongs to. */
  readonly Package?: string;
  /** The test the event belongs to. Absent for package-level events. */
  readonly Test?: string;
  /** The text that was produced. */
  readonly Output?: string;
  /** How long the test took, in seconds. */
  readonly Elapsed?: number;
  /** The package whose build failed. */
  readonly FailedBuild?: string;
  /** The package that was being built. */
  readonly ImportPath?: string;
}

/** What happened to a test. */
export type TestAction = 'run' | 'pass' | 'fail' | 'skip';

/** The outcome of one test. */
export interface TestOutcome {
  /** The name of the test, as the tool reports it. A subtest is `Parent/Sub`. */
  readonly name: string;
  /** What happened to it. */
  readonly action: TestAction;
  /** How long it took, in seconds. */
  readonly elapsed: number;
  /** The output it produced. */
  readonly output: string[];
}

/**
 * The outcome of a test, while the run is still in progress.
 *
 * The action and the duration are only known once the test has finished, so
 * they are filled in as the events arrive.
 */
interface PendingOutcome {
  name: string;
  action: TestAction;
  elapsed: number;
  output: string[];
}

/**
 * What is known about a package while the run is still in progress.
 */
interface PackageBuilder {
  package: string;
  tests: Map<string, PendingOutcome>;
  output: string[];
  failed: boolean;
  buildFailed: boolean;
}

/** The outcome of one package. */
export interface PackageResult {
  /** The import path of the package, which is how the tool reports it. */
  readonly package: string;
  /** The outcome of every test of the package that reported one, keyed by test name. */
  readonly tests: ReadonlyMap<string, TestOutcome>;
  /** The names of the tests of the package that failed. */
  readonly failedTests: readonly string[];
  /** The output the package produced. */
  readonly output: readonly string[];
  /** Whether the package failed. */
  readonly failed: boolean;
  /** Whether the package failed to build. */
  readonly buildFailed: boolean;
}

/** What a run produced. */
export interface GoTestResults {
  /**
   * The result of every package of the run, keyed by its import path.
   *
   * A run that tests one package has one entry. A run that tests several
   * packages has one entry for each of them, so that the outcome of a test
   * is attributed to the package it belongs to: two packages may hold a
   * test with the same name.
   */
  readonly packages: ReadonlyMap<string, PackageResult>;
  /** The output of the run, in the order it was produced. */
  readonly output: readonly string[];
  /** The build errors of the run, whose paths are relative to the working directory. */
  readonly buildOutput: readonly string[];
  /** The names of the packages that failed. */
  readonly failedPackages: readonly string[];
  /** Whether a package failed to build. */
  readonly buildFailed: boolean;
}

/** The output produced by one chunk of the stream. */
export interface ParsedChunk {
  /** The lines of ordinary test output. */
  readonly output: string[];
  /** The lines of build error, whose paths are relative to the working directory. */
  readonly buildOutput: string[];
}

/**
 * Reads the event stream of `go test -json` as it arrives.
 *
 * The stream is split into lines, and a line that is not a JSON object is
 * kept as ordinary output, so a tool that does not support `-json` still
 * shows what it printed.
 */
export class GoTestJsonParser {
  /** The part of a line that has not been read yet. */
  private buffer = '';

  /** What is known about every package seen so far. */
  private readonly packages = new Map<string, PackageBuilder>();

  /** The ordinary output of the run. */
  private readonly outputLines: string[] = [];

  /** The build errors of the run. */
  private readonly buildOutputLines: string[] = [];

  /** Whether a package failed to build. */
  private buildFailed = false;

  /**
   * Reads a chunk of the stream.
   *
   * @param chunk the text the process wrote.
   * @returns the output the chunk produced.
   */
  write(chunk: string): ParsedChunk {
    this.buffer += chunk;
    const output: string[] = [];
    const buildOutput: string[] = [];

    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.substring(0, newline);
      this.buffer = this.buffer.substring(newline + 1);
      this.handleLine(line, output, buildOutput);
      newline = this.buffer.indexOf('\n');
    }

    return { output, buildOutput };
  }

  /**
   * Reads whatever is left of the stream, once the process has closed it.
   *
   * @returns the output the last part produced.
   */
  end(): ParsedChunk {
    const output: string[] = [];
    const buildOutput: string[] = [];
    const rest = this.buffer;
    this.buffer = '';
    if (rest.length > 0) {
      this.handleLine(rest, output, buildOutput);
    }
    return { output, buildOutput };
  }

  /** What the run produced so far. */
  get results(): GoTestResults {
    const packages = new Map<string, PackageResult>();
    const failedPackages: string[] = [];

    this.packages.forEach((builder, name) => {
      const tests = new Map<string, TestOutcome>();
      const failedTests: string[] = [];

      builder.tests.forEach((outcome, testName) => {
        tests.set(testName, outcome);
        if (outcome.action === 'fail') {
          failedTests.push(testName);
        }
      });

      if (builder.failed) {
        failedPackages.push(name);
      }

      packages.set(name, {
        package: name,
        tests,
        failedTests,
        output: builder.output.slice(),
        failed: builder.failed,
        buildFailed: builder.buildFailed,
      });
    });

    return {
      packages,
      output: this.outputLines.slice(),
      buildOutput: this.buildOutputLines.slice(),
      failedPackages,
      buildFailed: this.buildFailed,
    };
  }

  /**
   * Reads one line of the stream.
   */
  private handleLine(line: string, output: string[], buildOutput: string[]) {
    const event = parseEvent(line);

    if (!event) {
      // Not an event, so it is output the tool printed on its own. It is
      // kept, so that a run whose output is not JSON still shows what
      // was printed.
      this.outputLines.push(line);
      output.push(line);
      return;
    }

    switch (event.Action) {
      case 'output': {
        const lines = splitLines(event.Output);
        this.outputLines.push(...lines);
        output.push(...lines);
        if (event.Package) {
          this.packageFor(event.Package).output.push(...lines);
        }
        if (event.Test && event.Package) {
          this.outcomeFor(event.Package, event.Test).output.push(...lines);
        }
        return;
      }
      case 'build-output': {
        const lines = splitLines(event.Output);
        this.buildOutputLines.push(...lines);
        buildOutput.push(...lines);
        return;
      }
      case 'build-fail': {
        this.buildFailed = true;
        // The import path of a build failure names the package that did
        // not build, followed by the name of its test binary.
        const buildFailed = packageOfBuildFailure(event.ImportPath);
        if (buildFailed) {
          this.packageFor(buildFailed).buildFailed = true;
        }
        return;
      }
      case 'run': {
        if (event.Test && event.Package) {
          this.outcomeFor(event.Package, event.Test);
        }
        return;
      }
      case 'pass':
      case 'fail':
      case 'skip': {
        if (event.Test && event.Package) {
          const outcome = this.outcomeFor(event.Package, event.Test);
          outcome.action = event.Action;
          outcome.elapsed = event.Elapsed ?? outcome.elapsed;
        } else if (event.Action === 'fail' && event.Package) {
          const pkg = this.packageFor(event.Package);
          pkg.failed = true;
          if (event.FailedBuild) {
            pkg.buildFailed = true;
          }
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * What is known about a package, created the first time the package is
   * seen.
   */
  private packageFor(name: string): PackageBuilder {
    let pkg = this.packages.get(name);
    if (!pkg) {
      pkg = { package: name, tests: new Map(), output: [], failed: false, buildFailed: false };
      this.packages.set(name, pkg);
    }
    return pkg;
  }

  /**
   * The outcome of a test, created the first time the test is seen.
   */
  private outcomeFor(packageName: string, name: string): PendingOutcome {
    const pkg = this.packageFor(packageName);
    let outcome = pkg.tests.get(name);
    if (!outcome) {
      outcome = { name, action: 'run', elapsed: 0, output: [] };
      pkg.tests.set(name, outcome);
    }
    return outcome;
  }
}

/**
 * The package that a build failure belongs to.
 *
 * The tool names the package that did not build, followed by the name of its
 * test binary: `example.com/mod/pkg [example.com/mod/pkg.test]`.
 *
 * @param importPath the import path the tool reported.
 * @returns the import path of the package, or undefined when there is none.
 */
function packageOfBuildFailure(importPath: string | undefined): string | undefined {
  if (!importPath) {
    return undefined;
  }
  const separator = importPath.indexOf(' ');
  return separator > 0 ? importPath.substring(0, separator) : importPath;
}

/**
 * Whether a test failed, either on its own or through one of its subtests.
 *
 * A test fails when it or any descendant of it fails, so a failure in
 * `TestAlpha/sub` marks `TestAlpha` as failed.
 *
 * @param failedTests the names of the tests that failed.
 * @param testName the name of the test to check.
 */
export function hasFailed(failedTests: readonly string[], testName: string): boolean {
  const prefix = testName + '/';
  return failedTests.some((failed) => failed === testName || failed.startsWith(prefix));
}

/**
 * Reads an event from a line of the stream.
 *
 * @param line the line to read.
 * @returns the event, or null when the line is not one.
 */
function parseEvent(line: string): GoTestEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed[0] !== '{') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const event = parsed as { [key: string]: unknown };
  if (typeof event['Action'] !== 'string') {
    return null;
  }

  return {
    Action: event['Action'],
    Package: typeof event['Package'] === 'string' ? event['Package'] : undefined,
    Test: typeof event['Test'] === 'string' ? event['Test'] : undefined,
    Output: typeof event['Output'] === 'string' ? event['Output'] : undefined,
    Elapsed: typeof event['Elapsed'] === 'number' ? event['Elapsed'] : undefined,
    FailedBuild: typeof event['FailedBuild'] === 'string' ? event['FailedBuild'] : undefined,
    ImportPath: typeof event['ImportPath'] === 'string' ? event['ImportPath'] : undefined,
  };
}

/**
 * Splits the text of an output event into lines.
 *
 * The text of an output event ends with a newline, which does not start a
 * line of its own.
 */
function splitLines(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
