import { findTestFiles } from './fileWalker';
import { scanGoFile, GoTestDecl } from './goScanner';
import { Config } from '../config';

/** A test file and the test functions declared in it. */
export interface DiscoveredSuite {
	/** The absolute path of the file. */
	readonly file: string;
	/** The test functions declared in the file, in source order. */
	readonly declarations: readonly GoTestDecl[];
	/**
	 * False when the file could not be scanned with confidence, in which case
	 * `declarations` may be incomplete.
	 */
	readonly confident: boolean;
	/** Why the file could not be scanned with confidence. */
	readonly reason?: string;
}

/**
 * Finds every test file under a root and scans it for test functions.
 *
 * This is the whole of discovery: it starts no processes, so it works on a
 * machine with no Go toolchain installed, and it reads each file exactly
 * once.
 *
 * @param root the directory to search.
 */
export async function discoverTests(root: string): Promise<DiscoveredSuite[]> {
	const files = await findTestFiles(root, {
		skipFolders: Config.SkipFolders,
		concurrency: Config.DiscoveryConcurrency
	});

	const suites = await mapWithConcurrency(files, Config.DiscoveryConcurrency, async file => {
		const scan = await scanGoFile(file);
		return {
			file,
			declarations: scan.declarations,
			confident: scan.confident,
			reason: scan.reason
		};
	});

	return suites;
}

/**
 * Maps over `items` with a bounded number of operations in flight.
 *
 * Every file used to be scanned at once, which thrashes the machine on a
 * large repository.
 */
export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, action: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;

	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await action(items[index]);
		}
	};

	const workers: Promise<void>[] = [];
	const limit = Math.min(Math.max(1, concurrency), items.length);
	for (let i = 0; i < limit; i++) {
		workers.push(worker());
	}
	await Promise.all(workers);

	return results;
}
