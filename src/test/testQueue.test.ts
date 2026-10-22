import { describe, it, expect } from 'vitest';
import { TestQueue } from '../runner/testQueue';
import { RawTestResult } from '../rawTestResult';
import { TestConfig } from '../lib/testUtil';
import { Uri } from './mocks/vscode';

function makeConfig(name: string): TestConfig {
	return {
		dir: '/repo',
		settings: { buildTags: '', testFlags: [], timeout: '30s', envFile: '', env: {} },
		flags: [],
		functions: [name],
		testUri: Uri.file(`/repo/${name}.go`),
		testName: name
	} as unknown as TestConfig;
}

function ok(): RawTestResult {
	return new RawTestResult(true, [], []);
}

describe('TestQueue', () => {
	it('runs queued work and reports completion', async () => {
		const completed: string[] = [];
		const queue = new TestQueue(
			async (config) => { completed.push(config.testName); return ok(); },
			2,
			(config) => { completed.push(`done:${config.testName}`); },
			() => { completed.push('failed'); });

		queue.enqueue(makeConfig('A'));
		queue.enqueue(makeConfig('B'));

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);

		expect(completed).toContain('done:A');
		expect(completed).toContain('done:B');
		expect(completed).not.toContain('failed');
	});

	it('never runs more than maxParallel invocations at once', async () => {
		let current = 0;
		let peak = 0;
		const queue = new TestQueue(
			async () => {
				current++;
				peak = Math.max(peak, current);
				await new Promise(r => setTimeout(r, 5));
				current--;
				return ok();
			},
			3,
			() => { },
			() => { });

		for (let i = 0; i < 10; i++) {
			queue.enqueue(makeConfig(`T${i}`));
		}

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);
		expect(peak).toBeLessThanOrEqual(3);
	});

	it('does not exceed maxParallel by one', async () => {
		// The old guard was `count > maxParallel`, which admitted 21 runs
		// when the limit was 20.
		let current = 0;
		let peak = 0;
		const queue = new TestQueue(
			async () => {
				current++;
				peak = Math.max(peak, current);
				await new Promise(r => setTimeout(r, 5));
				current--;
				return ok();
			},
			4,
			() => { },
			() => { });

		for (let i = 0; i < 12; i++) {
			queue.enqueue(makeConfig(`T${i}`));
		}

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);
		expect(peak).toBe(4);
	});

	it('releases the slot when a run rejects, so later work still runs', async () => {
		const failed: string[] = [];
		const completed: string[] = [];
		const queue = new TestQueue(
			async (config) => {
				if (config.testName === 'BOOM') {
					throw new Error('run exploded');
				}
				return ok();
			},
			1,
			(config) => { completed.push(config.testName); },
			(config) => { failed.push(config.testName); });

		queue.enqueue(makeConfig('BOOM'));
		queue.enqueue(makeConfig('AFTER'));

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);

		expect(failed).toEqual(['BOOM']);
		expect(completed).toEqual(['AFTER']);
	});

	it('survives a long run of failures without wedging', async () => {
		// The original bug: the in-flight counter leaked on every failure.
		// After `maxParallel` failures the queue refused to start anything
		// else, and the extension silently stopped running tests.
		let attempted = 0;
		const queue = new TestQueue(
			async () => {
				attempted++;
				throw new Error('always fails');
			},
			2,
			() => { },
			() => { });

		for (let i = 0; i < 25; i++) {
			queue.enqueue(makeConfig(`T${i}`));
		}

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);
		expect(attempted).toBe(25);
	});

	it('releases the slot when a run throws synchronously', async () => {
		const completed: string[] = [];
		const queue = new TestQueue(
			((config: TestConfig) => {
				if (config.testName === 'THROW') {
					throw new Error('sync boom');
				}
				return Promise.resolve(ok());
			}) as (config: TestConfig) => Promise<RawTestResult>,
			1,
			(config) => { completed.push(config.testName); },
			() => { });

		queue.enqueue(makeConfig('THROW'));
		queue.enqueue(makeConfig('AFTER'));

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);
		expect(completed).toEqual(['AFTER']);
	});

	it('reads the parallelism limit again when it changes', async () => {
		let limit = 1;
		const started: string[] = [];
		const queue = new TestQueue(
			async (config) => {
				started.push(config.testName);
				await new Promise(r => setTimeout(r, 10));
				return ok();
			},
			() => limit,
			() => { },
			() => { });

		queue.enqueue(makeConfig('A'));
		queue.enqueue(makeConfig('B'));
		expect(started).toEqual(['A']);

		// A limit of two now admits the work that was waiting, without
		// waiting for A to finish.
		limit = 2;
		queue.enqueue(makeConfig('C'));

		expect(started).toEqual(['A', 'B']);

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);
		expect(started).toEqual(['A', 'B', 'C']);
	});

	it('drops the work that has not started when it is cancelled', async () => {
		const completed: string[] = [];
		let release: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		const queue = new TestQueue(
			async () => { await held; return ok(); },
			1,
			(config) => { completed.push(config.testName); },
			() => { });

		queue.enqueue(makeConfig('HELD'));
		queue.enqueue(makeConfig('QUEUED'));

		// The first invocation holds the only slot, so the second one waits.
		await vi_waitFor(() => queue.running === 1);
		queue.cancel();

		release();
		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);

		expect(completed).toEqual(['HELD']);
	});

	it('keeps the slot it released for the work that did not start', async () => {
		const completed: string[] = [];
		const queue = new TestQueue(
			async (config) => { completed.push(config.testName); return ok(); },
			1,
			(config) => { completed.push(`done:${config.testName}`); },
			() => { });

		queue.enqueue(makeConfig('A'));
		queue.enqueue(makeConfig('B'));
		queue.cancel();

		await vi_waitFor(() => queue.pending === 0 && queue.running === 0);

		// The first invocation was already running, so it is not dropped.
		expect(completed).toContain('done:A');
		expect(completed).not.toContain('done:B');
	});
});

/**
 * Polls until the predicate holds, so tests do not depend on a fixed sleep.
 */
async function vi_waitFor(predicate: () => boolean, timeoutMs: number = 5000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('timed out waiting for condition');
		}
		await new Promise(r => setTimeout(r, 5));
	}
}
