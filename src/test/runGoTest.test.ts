import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { runGoTest, isToolAvailable, cancelRunningTests } from '../lib/testUtil';
import { buildRunRegex } from '../lib/testArgs';
import {
  __state,
  __reset,
  __setConfiguration,
  CancellationToken,
  CancellationTokenSource,
  Uri,
} from './mocks/vscode';

/**
 * These tests run the real Go toolchain against a fixture, so they are
 * skipped when there is no toolchain to run.
 */
const hasGo = isToolAvailable('go');

const PASSING = `package fixture

import "testing"

func TestPassing(t *testing.T) {}
`;

const FAILING = `package fixture

import "testing"

func TestFailing(t *testing.T) {
	t.Run("sub", func(t *testing.T) {
		t.Errorf("boom")
	})
}
`;

const SIBLING = `
func TestPassingExtra(t *testing.T) {}
`;

const FAST_THEN_SLOW = `package fixture

import (
	"testing"
	"time"
)

func TestFast(t *testing.T) {}

func TestLater(t *testing.T) {
	time.Sleep(2 * time.Second)
}
`;

const SLOW = `package cancelfixture

import (
	"testing"
	"time"
)

func TestSlow(t *testing.T) {
	time.Sleep(60 * time.Second)
}
`;

let fixture: string;

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-exec-'));
  fs.writeFileSync(path.join(fixture, 'go.mod'), 'module gotestexplorerfixture\n\ngo 1.21\n');
});

afterAll(() => {
  // On Windows a test binary that was killed in the middle of a run keeps its
  // working directory locked for a moment, so wait for it instead of failing
  // the suite. A folder that is still locked after that is left for the
  // operating system to clear from the temp directory: it is not a failure
  // of the code under test.
  try {
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch (error) {
    const locked = ['EBUSY', 'EPERM', 'ENOTEMPTY'];
    if (!locked.includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error;
    }
  }
});

beforeEach(() => {
  __reset();
  __setConfiguration('go', { testTimeout: '60s', testFlags: [] });
});

/**
 * Runs the tests of the fixture and returns the outcome.
 */
async function runFixture(functions: string[], body: string = FAILING, token?: CancellationToken) {
  const file = path.join(fixture, 'a_test.go');
  fs.writeFileSync(file, body);

  return runGoTest(
    {
      dir: fixture,
      settings: { buildTags: '', testFlags: [], timeout: '60s', envFile: '', env: {} },
      flags: [],
      functions,
      testUri: Uri.file(file),
      testName: 'a_test.go',
    },
    token,
  );
}

/**
 * Runs several packages of the fixture in one process.
 */
async function runPackages(packages: { importPath: string; path: string }[]) {
  return runGoTest({
    dir: fixture,
    settings: { buildTags: '', testFlags: [], timeout: '60s', envFile: '', env: {} },
    flags: [],
    functions: [],
    testUri: Uri.file(path.join(fixture, 'a_test.go')),
    testName: 'a_test.go',
    packages: packages.map((pkg) => ({
      importPath: pkg.importPath,
      path: pkg.path,
      files: [] as { uri: Uri; name: string; functions: string[] }[],
    })),
  });
}

describe.skipIf(!hasGo)('runGoTest reports a test as soon as it finishes', () => {
  it('reports a fast test while a slow one is still running', async () => {
    const file = path.join(fixture, 'a_test.go');
    fs.writeFileSync(file, FAST_THEN_SLOW);
    const reported: { name: string; at: number }[] = [];

    const result = await runGoTest({
      dir: fixture,
      settings: { buildTags: '', testFlags: [], timeout: '60s', envFile: '', env: {} },
      flags: [],
      functions: ['TestFast', 'TestLater'],
      testUri: Uri.file(file),
      testName: 'a_test.go',
      onTestFinished: (test) => reported.push({ name: test.name, at: Date.now() }),
    });
    const finishedAt = Date.now();

    expect(result.isPassed).toBe(true);
    expect(reported.map((t) => t.name)).toEqual(['TestFast', 'TestLater']);
    // TestLater sleeps for two seconds, so the fast test was shown well
    // before the run ended.
    expect(finishedAt - reported[0].at).toBeGreaterThan(1000);
  });
});

describe.skipIf(!hasGo)('runGoTest when the process cannot be started', () => {
  it('fails the run instead of waiting for ever', async () => {
    // More arguments than any operating system accepts, so the spawn fails.
    const packages = Array.from({ length: 300000 }, (_, index) => ({
      importPath: `gotestexplorerfixture/pkg${index}`,
      path: `pkg${index}`,
      files: [] as { uri: Uri; name: string; functions: string[] }[],
    }));

    const result = await runGoTest({
      dir: fixture,
      settings: { buildTags: '', testFlags: [], timeout: '60s', envFile: '', env: {} },
      flags: [],
      functions: [],
      testUri: Uri.file(path.join(fixture, 'a_test.go')),
      testName: 'a_test.go',
      packages,
    });

    expect(result.isPassed).toBe(false);
    expect(result.err).toBeInstanceOf(Error);
    expect(result.failedTests).toEqual([]);
  }, 10000);
});

describe.skipIf(!hasGo)('runGoTest', () => {
  it('reports a test that failed', async () => {
    const result = await runFixture(['TestFailing']);

    expect(result.isPassed).toBe(false);
    expect(result.failedTests).toContain('TestFailing');
  });

  it('reports a test that passed', async () => {
    const result = await runFixture(['TestPassing'], PASSING);

    expect(result.isPassed).toBe(true);
    expect(result.failedTests).toEqual([]);
  });

  it('reports the failure of a subtest', async () => {
    const result = await runFixture(['TestFailing']);

    expect(result.failedTests).toContain('TestFailing/sub');
  });

  it('keeps the output of the run', async () => {
    const result = await runFixture(['TestFailing']);

    expect(result.output.join('\n')).toContain('boom');
  });

  it('writes the output to the terminal', async () => {
    await runFixture(['TestFailing']);

    // The terminal is made when the first run writes to it.
    const terminal = __state.terminals[__state.terminals.length - 1];

    expect(terminal.name).toBe('Go Test Explorer');
    expect(terminal.text).toContain('boom');
  });

  it('shows the timeout that is in force', async () => {
    await runFixture(['TestFailing']);

    const terminal = __state.terminals[__state.terminals.length - 1];

    expect(terminal.text).toContain('Timeout: 60s');
  });

  it('shows the terminal of the output', async () => {
    await runFixture(['TestFailing']);

    const terminal = __state.terminals[__state.terminals.length - 1];

    expect(terminal.shown).toBe(true);
  });

  it('reports a package that does not build', async () => {
    const result = await runFixture(
      ['TestFailing'],
      `package fixture

import "testing"

func TestFailing(t *testing.T) {
	undefinedFunction()
}
`,
    );

    expect(result.isPassed).toBe(false);
    expect(result.failedTests).toEqual([]);
    expect(result.output.join('\n')).toContain('undefinedFunction');
  });

  it('runs only the tests that were asked for', async () => {
    // `TestPassingExtra` is a different test from `TestPassing`, and the
    // regex must not match it.
    const result = await runFixture(['TestPassing'], PASSING + SIBLING);

    expect(result.isPassed).toBe(true);
    expect(result.output.join('\n')).toContain('=== RUN   TestPassing');
    expect(result.output.join('\n')).not.toContain('=== RUN   TestPassingExtra');
  });

  it('runs only the tests that were asked for, with a group of names', async () => {
    const body =
      PASSING +
      SIBLING +
      `
func TestOther(t *testing.T) {}
`;
    const result = await runFixture(['TestPassing', 'TestOther'], body);

    expect(result.isPassed).toBe(true);
    expect(result.output.join('\n')).not.toContain('=== RUN   TestPassingExtra');
  });
});

describe.skipIf(!hasGo)('a run that tests several packages', () => {
  it('reports the outcome of every package', async () => {
    const dirA = path.join(fixture, 'a');
    const dirB = path.join(fixture, 'b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'a_test.go'), PASSING);
    fs.writeFileSync(path.join(dirB, 'b_test.go'), FAILING);

    const result = await runPackages([
      { importPath: 'gotestexplorerfixture/a', path: 'a' },
      { importPath: 'gotestexplorerfixture/b', path: 'b' },
    ]);

    expect(result.packages.size).toBe(2);
    expect(result.packages.get('gotestexplorerfixture/a')?.failed).toBe(false);
    expect(result.packages.get('gotestexplorerfixture/a')?.failedTests).toEqual([]);
    expect(result.packages.get('gotestexplorerfixture/b')?.failed).toBe(true);
    expect(result.packages.get('gotestexplorerfixture/b')?.failedTests).toContain('TestFailing');
  });

  it('keeps the output of every package apart', async () => {
    const dirA = path.join(fixture, 'a');
    const dirB = path.join(fixture, 'b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'a_test.go'), PASSING);
    fs.writeFileSync(path.join(dirB, 'b_test.go'), FAILING);

    const result = await runPackages([
      { importPath: 'gotestexplorerfixture/a', path: 'a' },
      { importPath: 'gotestexplorerfixture/b', path: 'b' },
    ]);

    expect(result.packages.get('gotestexplorerfixture/a')?.output.join('\n')).toContain(
      'TestPassing',
    );
    expect(result.packages.get('gotestexplorerfixture/a')?.output.join('\n')).not.toContain('boom');
    expect(result.packages.get('gotestexplorerfixture/b')?.output.join('\n')).toContain('boom');
  });

  it('runs the package at the root of the module', async () => {
    fs.writeFileSync(path.join(fixture, 'a_test.go'), PASSING);

    const result = await runPackages([{ importPath: 'gotestexplorerfixture', path: '' }]);

    expect(result.packages.get('gotestexplorerfixture')?.failed).toBe(false);
    expect(result.packages.get('gotestexplorerfixture')?.tests.get('TestPassing')?.action).toBe(
      'pass',
    );
  });

  it('runs the tests of every package, not only the first', async () => {
    const dirA = path.join(fixture, 'a');
    const dirB = path.join(fixture, 'b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'a_test.go'), PASSING);
    fs.writeFileSync(path.join(dirB, 'b_test.go'), PASSING);

    const result = await runPackages([
      { importPath: 'gotestexplorerfixture/a', path: 'a' },
      { importPath: 'gotestexplorerfixture/b', path: 'b' },
    ]);

    expect(result.isPassed).toBe(true);
    expect(result.output.join('\n')).toContain('TestPassing');
    expect(result.packages.get('gotestexplorerfixture/b')?.tests.get('TestPassing')?.action).toBe(
      'pass',
    );
  });
});

describe.skipIf(!hasGo)('the -run regex', () => {
  it('does not match a test whose name is a longer version of the one asked for', () => {
    // The bug this guards: `^TestAlpha|TestBeta$` parses as
    // `(^TestAlpha)|(TestBeta$)`, so `TestAlphaExtra` also matches.
    const regex = new RegExp(buildRunRegex(['TestPassing', 'TestOther']));
    expect(regex.test('TestPassingExtra')).toBe(false);
  });
});

describe.skipIf(!hasGo)('cancelling a run', () => {
  it('stops a run when the token is cancelled', async () => {
    const source = new CancellationTokenSource();
    const started = Date.now();
    const run = runFixture(['TestSlow'], SLOW, source.token);

    // The run needs a moment to start the tool.
    await new Promise((resolve) => setTimeout(resolve, 500));
    source.cancel();

    const result = await run;
    expect(result.isPassed).toBe(false);
    // The test sleeps for a minute, so a run that ended in seconds was
    // stopped rather than waited for.
    expect(Date.now() - started).toBeLessThan(30 * 1000);
  });

  it('stops every run that is in flight', async () => {
    const started = Date.now();
    const run = runFixture(['TestSlow'], SLOW);

    // The process is registered a moment after the run is started.
    let stopped = 0;
    for (let attempt = 0; attempt < 50 && stopped === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      stopped = cancelRunningTests();
    }

    expect(stopped).toBeGreaterThan(0);
    const result = await run;
    expect(result.isPassed).toBe(false);
    expect(Date.now() - started).toBeLessThan(30 * 1000);
  });

  it('reports that nothing was running when there is nothing to stop', () => {
    expect(cancelRunningTests()).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('kills the test binary, not only the tool', async () => {
    const source = new CancellationTokenSource();
    const run = runFixture(['TestSlow'], SLOW, source.token);

    // The tool compiles the package and runs its binary. A cold build cache
    // makes the compile slow, so wait for the binary instead of guessing.
    expect(await waitFor(testBinaryRunning, 20000)).toBe(true);

    source.cancel();
    await run;

    // The binary is killed with the tool, so it does not keep running.
    expect(await waitFor(() => !testBinaryRunning(), 5000)).toBe(true);
  });
});

/**
 * Polls until the condition holds, and reports whether it did in time.
 */
async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

/**
 * Reports whether the binary the tool compiled is still running.
 */
function testBinaryRunning(): boolean {
  try {
    const listing = cp.execFileSync('ps', ['-eo', 'args']).toString();
    return listing
      .split('\n')
      .some((line) => line.trim().split(' ')[0].endsWith('gotestexplorerfixture.test'));
  } catch {
    return false;
  }
}
