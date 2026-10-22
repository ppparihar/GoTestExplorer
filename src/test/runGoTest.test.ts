import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import cp = require('child_process');
import { runGoTest, isToolAvailable, cancelRunningTests } from '../lib/testUtil';
import { buildRunRegex } from '../lib/testArgs';
import { __state, __reset, __setConfiguration, CancellationToken, CancellationTokenSource, Uri, WorkspaceConfiguration } from './mocks/vscode';

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
	fs.rmSync(fixture, { recursive: true, force: true });
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

	return runGoTest({
		dir: fixture,
		goConfig: new WorkspaceConfiguration({ testTimeout: '60s', testFlags: [] }),
		flags: [],
		functions,
		testUri: Uri.file(file),
		testName: 'a_test.go'
	}, token);
}

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

	it('writes the output to the output channel', async () => {
		// The channel is created when the runner module is loaded, and a run
		// clears it before it writes, so it holds the output of this run.
		const channel = __state.outputChannels[__state.outputChannels.length - 1];

		await runFixture(['TestFailing']);

		expect(channel.name).toBe('Go Test Explorer');
		expect(channel.lines.join('\n')).toContain('boom');
	});

	it('reports a package that does not build', async () => {
		const result = await runFixture(['TestFailing'], `package fixture

import "testing"

func TestFailing(t *testing.T) {
	undefinedFunction()
}
`);

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
		const body = PASSING + SIBLING + `
func TestOther(t *testing.T) {}
`;
		const result = await runFixture(['TestPassing', 'TestOther'], body);

		expect(result.isPassed).toBe(true);
		expect(result.output.join('\n')).not.toContain('=== RUN   TestPassingExtra');
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
		await new Promise(resolve => setTimeout(resolve, 500));
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
			await new Promise(resolve => setTimeout(resolve, 100));
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

		// The tool compiles the package and runs its binary.
		await new Promise(resolve => setTimeout(resolve, 2000));
		expect(testBinaryRunning()).toBe(true);

		source.cancel();
		await run;

		// The binary is killed with the tool, so it does not keep running.
		await new Promise(resolve => setTimeout(resolve, 1000));
		expect(testBinaryRunning()).toBe(false);
	});
});

/**
 * Reports whether the binary the tool compiled is still running.
 */
function testBinaryRunning(): boolean {
	try {
		const listing = cp.execFileSync('ps', ['-eo', 'comm']).toString();
		return listing.split('\n').some(line => line.trim().endsWith('gotestexplorerfixture.test'));
	} catch (e) {
		return false;
	}
}
