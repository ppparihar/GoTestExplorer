import * as path from 'node:path';
import * as os from 'node:os';
import * as cp from 'node:child_process';

export interface ExecResult {
	packages: number;
	durationMs: number;
	exitCode: number;
}

/**
 * Measures how long `go test ./...` takes over the fixture.
 *
 * This is the work the extension asks the Go toolchain to do, so it sets the
 * floor on how long a "run all" can take.
 */
export function runExecBench(root: string): Promise<ExecResult> {
	return new Promise<ExecResult>((resolve, reject) => {
		const started = process.hrtime.bigint();
		cp.execFile('go', ['test', './...'], { cwd: root }, (err, stdout, stderr) => {
			const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
			const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
			if (err && exitCode !== 0 && exitCode !== 1) {
				reject(new Error(stderr || err.message));
				return;
			}
			resolve({ packages: countPackages(stdout), durationMs, exitCode });
		});
	});
}

function countPackages(stdout: string): number {
	return stdout.split('\n').filter(line => /^(ok|FAIL|\?)\s/.test(line)).length;
}

async function main(): Promise<void> {
	const { generateFixture } = await import('./fixtures/gen.js');
	const fixture = generateFixture(path.join(os.tmpdir(), 'gotestexplorer-bench-exec'));
	const result = await runExecBench(fixture.root);
	console.log(JSON.stringify({
		bench: 'exec',
		...result,
		packagesGenerated: fixture.packages
	}, null, 2));
}

if (require.main === module) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
