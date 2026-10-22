/**
 * Pure helpers for building `go test` command-line arguments.
 *
 * This module deliberately has no dependency on `vscode` so that the argument
 * construction can be unit tested without an extension host.
 */

/**
 * Default `go test` timeout, matching the Go extension's own `go.testTimeout`
 * default. Used when the setting is absent so that a run never fails with
 * `invalid value "undefined" for flag -timeout`.
 */
export const DEFAULT_TEST_TIMEOUT = '30s';

/**
 * Builds the `-run` (or `-bench`) regex for a set of test function names.
 *
 * The alternation must be wrapped in a group so the anchors bind to the whole
 * expression: `^(A|B)$`. Without the group, `^A|B$` parses as `(^A)|(B$)`,
 * which also matches unrelated tests such as `AExtra` or `XB`.
 */
export function buildRunRegex(testFunctions: string[]): string {
  return `^(${testFunctions.join('|')})$`;
}

/**
 * Resolves the value to pass to `go test -timeout`.
 *
 * Returns the configured value when it is a usable non-empty string, and
 * {@link DEFAULT_TEST_TIMEOUT} otherwise. `undefined` is never returned: `go
 * test` rejects the literal string "undefined" as an invalid duration.
 */
export function resolveTestTimeout(configured: unknown): string {
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  return DEFAULT_TEST_TIMEOUT;
}

/**
 * The subset of {@link TestConfig} needed to build the run target arguments.
 */
export interface TargetArgsInput {
  /** Specific test function names to run. */
  functions?: string[];
  /** Whether the target is a benchmark rather than a test. */
  isBenchmark?: boolean;
}

/**
 * Builds the test-target arguments (`-run` / `-bench`) for a `go test` invocation.
 */
export function buildTargetArgs(input: TargetArgsInput): string[] {
  if (input.functions) {
    if (input.isBenchmark) {
      return ['-bench', buildRunRegex(input.functions)];
    }
    if (input.functions.length > 0) {
      return ['-run', buildRunRegex(input.functions)];
    }
    return [];
  }
  if (input.isBenchmark) {
    return ['-bench', '.'];
  }
  return [];
}
