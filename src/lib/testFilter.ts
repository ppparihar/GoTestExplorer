/**
 * Pure helpers for narrowing the tests shown in the tree to a search text.
 *
 * This module deliberately has no dependency on `vscode`, so that the matching
 * can be unit tested without an extension host.
 */

/**
 * Whether a name matches the search text: every word of the text must appear
 * in the name, in any order, ignoring case. An empty text matches everything.
 */
export function matchesFilter(name: string, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = name.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/**
 * What is known about a test: it passed, it failed, or it has not run yet.
 */
export type TestStatus = 'passed' | 'failed' | 'notRun';

/**
 * What the tree is narrowed to. Both parts must hold for a test to be shown.
 */
export interface TestFilter {
  /** Words the name of the test, or of its file, must have. */
  text: string;
  /** The statuses a test may have. Empty means any status. */
  statuses: ReadonlySet<TestStatus>;
}

/**
 * Whether a filter narrows anything.
 */
export function isActive(filter: TestFilter): boolean {
  return filter.text.trim() !== '' || filter.statuses.size > 0;
}

interface Leaf {
  name: string;
  status: TestStatus;
}

interface Suite<T extends Leaf> {
  name: string;
  children: T[];
}

/**
 * The tests of a file that are shown.
 *
 * A file whose own name matches the text shows all of its tests for it,
 * otherwise a test must match the text itself. The status is always the
 * status of the test.
 */
export function visibleChildren<T extends Leaf>(suite: Suite<T>, filter: TestFilter): T[] {
  const fileMatches = matchesFilter(suite.name, filter.text);
  return suite.children.filter(
    (child) =>
      (fileMatches || matchesFilter(child.name, filter.text)) &&
      (filter.statuses.size === 0 || filter.statuses.has(child.status)),
  );
}

/**
 * The files that have a test to show.
 */
export function visibleSuites<T extends Suite<Leaf>>(suites: T[], filter: TestFilter): T[] {
  if (!isActive(filter)) {
    return suites;
  }
  return suites.filter((suite) => visibleChildren(suite, filter).length > 0);
}
