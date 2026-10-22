import * as fs from 'fs';
import { scanGoFile, GoTestDecl } from './goScanner';

/** The outcome of scanning a file, without the bookkeeping used to cache it. */
export interface CachedScan {
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

interface CacheEntry extends CachedScan {
	/** The modification time of the file when it was read. */
	readonly mtimeMs: number;
	/** The size of the file when it was read. */
	readonly size: number;
}

/**
 * Caches the result of scanning a file, keyed by its path.
 *
 * A file is read and parsed again only when its modification time or its size
 * has changed, so refreshing the tree costs one `stat` per file rather than
 * one read and one parse. The watcher invalidates a file as soon as it
 * changes, so an edit is never hidden by a stale entry even on a file system
 * with a coarse modification time.
 */
export class ScanCache {

	private readonly entries = new Map<string, CacheEntry>();

	/**
	 * Scans a file, reusing the cached result when the file has not changed.
	 *
	 * @param file the path of the file to scan.
	 * @returns the test declarations in the file.
	 */
	async scan(file: string): Promise<CachedScan> {
		const stats = await statOf(file);
		const cached = this.entries.get(file);

		if (cached && stats && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
			return cached;
		}

		const scan = await scanGoFile(file);
		const entry: CacheEntry = {
			declarations: scan.declarations,
			confident: scan.confident,
			reason: scan.reason,
			mtimeMs: stats ? stats.mtimeMs : -1,
			size: stats ? stats.size : -1
		};
		this.entries.set(file, entry);
		return entry;
	}

	/**
	 * Forgets the cached result of a file, so that it is read again the next
	 * time it is scanned.
	 *
	 * @param file the path of the file to forget.
	 */
	invalidate(file: string): void {
		this.entries.delete(file);
	}

	/** Forgets every cached result. */
	clear(): void {
		this.entries.clear();
	}

	/** The number of files currently held in the cache. */
	get size(): number {
		return this.entries.size;
	}
}

/**
 * Reads the metadata of a file.
 *
 * @returns the metadata, or null when the file cannot be read.
 */
async function statOf(file: string): Promise<{ mtimeMs: number; size: number } | null> {
	try {
		const stats = await fs.promises.stat(file);
		return { mtimeMs: stats.mtimeMs, size: stats.size };
	} catch (e) {
		return null;
	}
}
