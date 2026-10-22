import * as path from 'node:path';
import * as os from 'node:os';
import { discoverTests } from '../src/discovery/discover';
import { ScanCache } from '../src/discovery/scanCache';

export interface DiscoveryResult {
	files: number;
	tests: number;
	durationMs: number;
	/**
	 * The number of child processes started while discovering. Discovery must
	 * not start any: the whole point of the in-process scanner is that the
	 * extension works on a machine with no Go toolchain installed.
	 */
	spawns: number;
}

/**
 * Counts the child processes started by the code under test.
 *
 * `child_process.spawn` and `child_process.execFile` are the two ways a
 * process is started from Node; both are wrapped so the count is exact.
 */
export function countSpawns(): { getCount: () => number; restore: () => void } {
	const cp = require('child_process');
	let count = 0;
	const originalSpawn = cp.spawn;
	const originalExecFile = cp.execFile;

	cp.spawn = function (...args: unknown[]) {
		count++;
		return (originalSpawn as any).apply(cp, args);
	};
	cp.execFile = function (...args: unknown[]) {
		count++;
		return (originalExecFile as any).apply(cp, args);
	};

	return {
		getCount: () => count,
		restore: () => {
			cp.spawn = originalSpawn;
			cp.execFile = originalExecFile;
		}
	};
}

/**
 * Measures how long it takes to find and scan every test file under a root.
 *
 * This is the work the extension does when the test view is refreshed, so it
 * is the number that matters for how responsive discovery feels.
 */
export async function runDiscoveryBench(root: string): Promise<DiscoveryResult> {
	const started = process.hrtime.bigint();
	const counter = countSpawns();

	try {
		const suites = await discoverTests(root);
		const tests = suites.reduce((sum, suite) => sum + suite.declarations.length, 0);

		const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
		return { files: suites.length, tests, durationMs, spawns: counter.getCount() };
	} finally {
		counter.restore();
	}
}

/**
 * Measures a discovery that reuses a cache of scan results.
 *
 * This is what the extension does when the tree is refreshed and no file has
 * changed: the files are stat-ed but not read and parsed again.
 */
export async function runCachedDiscoveryBench(root: string, cache: ScanCache): Promise<DiscoveryResult> {
	const started = process.hrtime.bigint();
	const counter = countSpawns();

	try {
		const suites = await discoverTests(root, { cache });
		const tests = suites.reduce((sum, suite) => sum + suite.declarations.length, 0);

		const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
		return { files: suites.length, tests, durationMs, spawns: counter.getCount() };
	} finally {
		counter.restore();
	}
}

async function main(): Promise<void> {
	const { generateFixture } = await import('./fixtures/gen.js');
	const packages = Number(process.env['BENCH_PACKAGES'] || 20);
	const testsPerPackage = Number(process.env['BENCH_TESTS_PER_PACKAGE'] || 20);
	const filesPerPackage = Number(process.env['BENCH_FILES_PER_PACKAGE'] || 1);
	const fixture = generateFixture(
		path.join(os.tmpdir(), 'gotestexplorer-bench-discovery'),
		packages,
		testsPerPackage,
		filesPerPackage);
	const result = await runDiscoveryBench(fixture.root);
	console.log(JSON.stringify({
		bench: 'discovery',
		...result,
		packages: fixture.packages,
		testsPerPackage: fixture.testsPerPackage,
		filesPerPackage: fixture.filesPerPackage
	}, null, 2));
}

if (require.main === module) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
