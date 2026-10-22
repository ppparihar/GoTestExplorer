import fs = require('fs');
import path = require('path');

/**
 * A Go module.
 */
export interface GoModule {
	/**
	 * The directory that holds the `go.mod` file.
	 */
	readonly root: string;
	/**
	 * The module path, e.g. `example.com/mod`. It is the first part of the
	 * import path of every package of the module.
	 */
	readonly path: string;
}

/**
 * Finds the module a directory belongs to.
 *
 * The `go.mod` file of the nearest directory that holds one decides: a
 * module inside another module is a module of its own.
 *
 * @param dir the directory to start from.
 * @returns the module, or undefined when the directory is not in one.
 */
export function findGoModule(dir: string): GoModule | undefined {
	let current = path.resolve(dir);
	for (;;) {
		const modFile = path.join(current, 'go.mod');
		if (fs.existsSync(modFile)) {
			const modulePath = readModulePath(modFile);
			return modulePath ? { root: current, path: modulePath } : undefined;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			// The root of the file system was reached without finding one.
			return undefined;
		}
		current = parent;
	}
}

/**
 * Reads the module path out of a `go.mod` file.
 *
 * @param modFile the file to read.
 * @returns the module path, or undefined when the file has none.
 */
function readModulePath(modFile: string): string | undefined {
	let content: string;
	try {
		content = fs.readFileSync(modFile, 'utf8');
	} catch (e) {
		return undefined;
	}
	for (const line of content.split('\n')) {
		// The directive is at the start of a line, and its path may be
		// quoted.
		const match = /^\s*module\s+("[^"]+"|\S+)/.exec(line);
		if (match) {
			return match[1].replace(/^"|"$/g, '');
		}
	}
	return undefined;
}

/**
 * The import path of a directory inside a module.
 *
 * The import path is what the tool reports a package as, so it is what the
 * outcome of a test is matched against.
 *
 * @param module the module the directory belongs to.
 * @param dir the directory of the package.
 * @returns the import path of the package.
 */
export function importPathOf(module: GoModule, dir: string): string {
	const relative = path.relative(module.root, dir).split(path.sep).join('/');
	return relative === '' ? module.path : module.path + '/' + relative;
}
