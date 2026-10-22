import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { getTestFunctions } from '../src/lib/testUtil';

export interface DiscoveryResult {
	files: number;
	tests: number;
	durationMs: number;
}

/**
 * Measures how long it takes to list the tests of every file in the fixture.
 *
 * This is the work the extension does when the test view is refreshed, so it
 * is the number that matters for how responsive discovery feels.
 */
export async function runDiscoveryBench(files: string[], concurrency = 8): Promise<DiscoveryResult> {
	const started = process.hrtime.bigint();
	let tests = 0;

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency);
		const counts = await Promise.all(batch.map(file =>
			getTestFunctions(vscode.Uri.file(file), null).then(result => result.length)));
		tests += counts.reduce((sum: number, count: number) => sum + count, 0);
	}

	const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
	return { files: files.length, tests, durationMs };
}

async function main(): Promise<void> {
	const { generateFixture } = await import('./fixtures/gen');
	const fixture = generateFixture(path.join(os.tmpdir(), 'gotestexplorer-bench-discovery'));
	const result = await runDiscoveryBench(fixture.files);
	console.log(JSON.stringify({
		bench: 'discovery',
		...result,
		packages: fixture.packages,
		testsPerPackage: fixture.testsPerPackage
	}, null, 2));
}

if (require.main === module) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
