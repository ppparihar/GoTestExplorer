import * as fs from 'fs';
import * as path from 'path';

/** How the walker should traverse a directory tree. */
export interface FindTestFilesOptions {
	/**
	 * Directory names to skip entirely, wherever they appear in the tree.
	 */
	readonly skipFolders: readonly string[];
	/**
	 * The maximum number of directories read at the same time.
	 */
	readonly concurrency: number;
}

/**
 * The name a Go test file must have to be picked up.
 */
export const TEST_FILE_SUFFIX = '_test.go';

/**
 * Finds every Go test file under a root directory.
 *
 * The walk is done with `readdir({withFileTypes: true})`, which costs one
 * syscall per directory instead of one `stat` per entry. Nothing is spawned,
 * so discovery works on a machine with no Go toolchain at all.
 *
 * @param root the directory to walk.
 * @param options how to traverse it.
 * @returns the absolute paths of the test files, in no particular order.
 */
export async function findTestFiles(root: string, options: FindTestFilesOptions): Promise<string[]> {
	const skip = new Set(options.skipFolders);
	const concurrency = Math.max(1, options.concurrency);

	const files: string[] = [];
	const directories: string[] = [root];
	// Symlinked directories can point back into the tree, so every directory
	// that is entered is remembered by its real path.
	const visited = new Set<string>();
	const rootRealPath = await realPathOf(root);
	if (rootRealPath) {
		visited.add(rootRealPath);
	}

	const worker = async (): Promise<void> => {
		while (directories.length > 0) {
			const directory = directories.shift() as string;
			let entries: fs.Dirent[];
			try {
				entries = await fs.promises.readdir(directory, { withFileTypes: true });
			} catch (e) {
				// A directory that cannot be read — a permission error, or one
				// that disappeared while the walk was running — is skipped
				// rather than failing the whole discovery.
				continue;
			}

			for (const entry of entries) {
				const fullPath = path.join(directory, entry.name);

				if (entry.isDirectory()) {
					if (!skip.has(entry.name)) {
						directories.push(fullPath);
					}
					continue;
				}

				if (entry.isSymbolicLink()) {
					const resolved = await resolveLink(fullPath);
					if (!resolved) {
						continue;
					}
					if (resolved.isDirectory) {
						// The path under the workspace is kept, so the file the
						// user sees is the one they opened; the real path is
						// only used to detect a cycle.
						if (!skip.has(entry.name) && !visited.has(resolved.realPath)) {
							visited.add(resolved.realPath);
							directories.push(fullPath);
						}
						continue;
					}
					if (resolved.isFile && entry.name.endsWith(TEST_FILE_SUFFIX)) {
						files.push(fullPath);
					}
					continue;
				}

				if (entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX)) {
					files.push(fullPath);
				}
			}
		}
	};

	const workers: Promise<void>[] = [];
	for (let i = 0; i < concurrency; i++) {
		workers.push(worker());
	}
	await Promise.all(workers);

	return files;
}

interface ResolvedLink {
	readonly isDirectory: boolean;
	readonly isFile: boolean;
	readonly realPath: string;
}

/**
 * Resolves the real path of a directory.
 *
 * @returns the real path, or null when it cannot be resolved.
 */
async function realPathOf(target: string): Promise<string | null> {
	try {
		return await fs.promises.realpath(target);
	} catch (e) {
		return null;
	}
}

/**
 * Resolves a symbolic link, following it to find out what it points at.
 *
 * @returns the target, or null when the link is broken.
 */
async function resolveLink(linkPath: string): Promise<ResolvedLink | null> {
	try {
		const stats = await fs.promises.stat(linkPath);
		return {
			isDirectory: stats.isDirectory(),
			isFile: stats.isFile(),
			realPath: await fs.promises.realpath(linkPath)
		};
	} catch (e) {
		return null;
	}
}
