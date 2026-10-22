import { PackageResult } from './exec/goTestJsonParser';
import { CoverProfile } from './lib/coverageProfile';

/**
 * The outcome of a run.
 */
export class RawTestResult {
  constructor(
    public isPassed: boolean,
    public output: string[],
    /**
     * The names of the tests that failed, across the whole run.
     *
     * A run that tests one package has one entry in {@link packages}, and
     * these are its failed tests. A run that tests several packages has
     * the failed tests of all of them, which is why the result of a
     * package is read from {@link packages} when there is more than one.
     */
    public failedTests: string[],
    public err?: Error,
    /**
     * The result of every package of the run, keyed by its import path.
     */
    public packages: ReadonlyMap<string, PackageResult> = new Map<string, PackageResult>(),
    /**
     * What the run covered, when it was asked to measure that.
     */
    public coverage?: CoverProfile,
  ) {}
}
