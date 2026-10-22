import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateFixture } from './fixtures/gen';
import { runDiscoveryBench, DiscoveryResult } from './discovery-bench';
import { runExecBench, ExecResult } from './exec-bench';
import { isToolAvailable } from '../src/lib/testUtil';

const PACKAGES = Number(process.env['BENCH_PACKAGES'] || 20);
const TESTS_PER_PACKAGE = Number(process.env['BENCH_TESTS_PER_PACKAGE'] || 20);

interface Baseline {
	timestamp: string;
	packages: number;
	testsPerPackage: number;
	discovery: { cold: DiscoveryResult; warm: DiscoveryResult };
	exec: { cold: ExecResult; warm: ExecResult };
}

async function main(): Promise<void> {
	if (!isToolAvailable('go-outline')) {
		console.error('go-outline is not on PATH. Install it with "go install github.com/ramya-rao-a/go-outline@latest" to run the discovery benchmark.');
		process.exit(1);
	}

	const root = path.join(os.tmpdir(), 'gotestexplorer-bench');
	const fixture = generateFixture(root, PACKAGES, TESTS_PER_PACKAGE);

	// Both benchmarks are measured twice. The first run pays for cold caches
	// (the outline process, the Go build cache); the second reflects the
	// steady state a user sees day to day. Recording both keeps the numbers
	// comparable across phases.
	const discoveryCold = await runDiscoveryBench(fixture.files);
	const discoveryWarm = await runDiscoveryBench(fixture.files);
	const execCold = await runExecBench(fixture.root);
	const execWarm = await runExecBench(fixture.root);

	const baseline: Baseline = {
		timestamp: new Date().toISOString(),
		packages: fixture.packages,
		testsPerPackage: fixture.testsPerPackage,
		discovery: { cold: discoveryCold, warm: discoveryWarm },
		exec: { cold: execCold, warm: execWarm }
	};

	const resultsDir = path.resolve(__dirname, 'results');
	fs.mkdirSync(resultsDir, { recursive: true });
	fs.writeFileSync(path.join(resultsDir, `run-${baseline.timestamp.replace(/[:.]/g, '-')}.json`), JSON.stringify(baseline, null, 2));
	fs.writeFileSync(path.join(resultsDir, 'baseline.json'), JSON.stringify(baseline, null, 2));

	console.log(JSON.stringify(baseline, null, 2));
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
