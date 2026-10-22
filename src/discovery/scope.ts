import * as path from 'path';
import { createMatcher } from './glob';

/**
 * A directory of the module cache: `name@v1.2.3`. It holds the sources of the
 * modules that were downloaded, and every test of every one of them. A GOPATH
 * inside a project would put thousands of tests in the tree.
 */
const MODULE_CACHE_DIRECTORY = /@v\d/;

/**
 * Tells whether a path is left out of the tree.
 *
 * The patterns are matched against the path relative to the workspace folder.
 * A folder that matches takes its contents with it.
 *
 * @param base the workspace folder the patterns are relative to.
 * @param patterns the glob patterns of the paths to leave out.
 * @returns a function that is true for a path that is left out.
 */
export function createScope(
  base: string,
  patterns: readonly string[],
): (fullPath: string, isDirectory: boolean) => boolean {
  const matches = createMatcher(patterns);
  return (fullPath, isDirectory) => {
    const relative = path.relative(base, fullPath).split(path.sep).join('/');
    if (relative === '' || relative.startsWith('..')) {
      return false;
    }
    if (isDirectory && MODULE_CACHE_DIRECTORY.test(path.basename(fullPath))) {
      return true;
    }
    return matches(relative);
  };
}

/**
 * Whether a file lies inside a folder of the module cache, or matches a
 * pattern: the same rules as {@link createScope}, for a file whose folders
 * were not walked, such as one a watcher reported.
 */
export function isFileLeftOut(
  base: string,
  filePath: string,
  patterns: readonly string[],
): boolean {
  const leftOut = createScope(base, patterns);
  const relative = path.relative(base, path.dirname(filePath));
  const segments = relative === '' ? [] : relative.split(path.sep);
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (leftOut(current, true)) {
      return true;
    }
  }
  return leftOut(filePath, false);
}
