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
 * The nodes of a file that are shown for the search text.
 *
 * A file whose own name matches shows all of its tests; otherwise only the
 * tests that match are shown. A file with nothing to show is dropped.
 */
export function visibleChildren<T extends { name: string }>(
  suite: { name: string; children: T[] },
  filter: string,
): T[] {
  if (matchesFilter(suite.name, filter)) {
    return suite.children;
  }
  return suite.children.filter((child) => matchesFilter(child.name, filter));
}

/**
 * The files that have something to show for the search text.
 */
export function visibleSuites<T extends { name: string; children: unknown[] }>(
  suites: T[],
  filter: string,
): T[] {
  if (!filter.trim()) {
    return suites;
  }
  return suites.filter(
    (suite) =>
      matchesFilter(suite.name, filter) ||
      visibleChildren(suite as unknown as { name: string; children: { name: string }[] }, filter)
        .length > 0,
  );
}
