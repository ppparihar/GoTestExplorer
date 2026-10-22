import { findTestFiles } from './fileWalker';
import { scanGoFile, GoTestDecl } from './goScanner';
import { ScanCache } from './scanCache';
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

/** How discovery should be carried out. */
export interface DiscoverOptions {
	/**
	 * A cache of scan results, so that a file that has not changed is not
	 * read and parsed again.
	 */
	readonly cache?: ScanCache;
}

/**
 * Finds every test file under a root and scans it for test functions.
 *
 * This is the whole of discovery: it starts no processes, so it works on a
 * machine with no Go toolchain installed, and it reads each file exactly
 * once.
 *
 * @param root the directory to search.
 * @param options how to carry out the discovery.
 */
export async function discoverTests(root: string, options?: DiscoverOptions): Promise<DiscoveredSuite[]> {
	const files = await findTestFiles(root, {
		skipFolders: Config.SkipFolders,
		concurrency: Config.DiscoveryConcurrency
	});

	const cache = options?.cache;
	const suites = await mapWithConcurrency<string, DiscoveredSuite | null>(files, Config.DiscoveryConcurrency, async file => {
		try {
			const scan = cache ? await cache.scan(file) : await scanGoFile(file);
			return {
				file,
				declarations: scan.declarations,
				confident: scan.confident,
				reason: scan.reason
			};
		} catch (e) {
			// The file was deleted between the walk and the read, so it is
			// no longer part of the tree.
			return null;
		}
	});

	return suites.filter((suite): suite is DiscoveredSuite => suite !== null);
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
