import { PackageResult } from '../exec/goTestJsonParser';
import { RawTestResult } from '../rawTestResult';
import { CoverProfile, mergeCoverProfiles } from '../lib/coverageProfile';

/**
 * How a list of packages is split into runs.
 */
export interface ChunkOptions {
  /**
   * The most packages in one run. Zero means no limit on the number.
   */
  maxPackages: number;
  /**
   * The most characters that the package arguments of one run may take.
   */
  maxArgChars: number;
}

/**
 * The most characters of package arguments that one run may carry when the
 * user has not asked for a number of packages.
 *
 * A process is started with a command line, and the system limits its length:
 * about 32,000 characters on Windows, and about a million bytes on macOS. A
 * module with thousands of packages can pass the Windows limit, and a run that
 * cannot start tests nothing. The budget is far below each limit, because the
 * command line also holds the flags, the tool and, on some systems, the
 * environment.
 */
export function argumentBudget(platform: string = process.platform): number {
  return platform === 'win32' ? 8000 : 100000;
}

/**
 * The argument that names a package to `go test`, relative to the directory
 * the run starts in.
 */
export function packageArgument(packagePath: string): string {
  return packagePath === '' ? '.' : './' + packagePath;
}

/**
 * Splits the packages of a module into runs.
 *
 * The runs are kept as large as the limits allow, because a single process
 * compiles the packages once and lets the tool decide how to spread them over
 * the cores. The order of the packages is kept, and a package is never split:
 * one that is longer than the budget runs alone.
 *
 * @returns the runs, none of them empty.
 */
export function chunkPackages<T extends { path: string }>(
  packages: readonly T[],
  options: ChunkOptions,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;

  packages.forEach((pkg) => {
    // One more for the space between two arguments.
    const size = packageArgument(pkg.path).length + 1;
    const tooMany = options.maxPackages > 0 && current.length >= options.maxPackages;
    const tooLong = current.length > 0 && chars + size > options.maxArgChars;
    if (tooMany || tooLong) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(pkg);
    chars += size;
  });

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Combines the results of the runs that one module was split into.
 *
 * The module passed when every run passed. The result of a package is read
 * from the run that tested it, so the packages are joined, and the output is
 * kept in the order of the runs.
 */
export function mergeResults(results: readonly RawTestResult[]): RawTestResult {
  const packages = new Map<string, PackageResult>();
  const output: string[] = [];
  const failedTests: string[] = [];
  let isPassed = true;
  let err: Error | undefined;
  const profiles: CoverProfile[] = [];

  results.forEach((result) => {
    if (result.coverage) {
      profiles.push(result.coverage);
    }
    isPassed = isPassed && result.isPassed;
    err = err ?? result.err;
    result.output.forEach((line) => output.push(line));
    result.failedTests.forEach((name) => failedTests.push(name));
    result.packages.forEach((value, key) => packages.set(key, value));
  });

  return new RawTestResult(
    isPassed,
    output,
    failedTests,
    err,
    packages,
    profiles.length > 0 ? mergeCoverProfiles(profiles) : undefined,
  );
}
