export class Config {
  /**
   * Directory names that are never walked when discovering test files.
   *
   * `vendor` and `testdata` are Go conventions: `vendor` holds a copy of
   * dependencies and `testdata` holds fixtures, neither of which contains
   * tests the user wants to run. The rest are build output and tooling
   * directories that hold no Go source worth scanning.
   */
  public static get SkipFolders(): string[] {
    return [
      'vendor',
      '.vscode',
      '.git',
      '.idea',
      'node_modules',
      'testdata',
      'dist',
      'build',
      'out',
      'third_party',
      'proto',
      'generated',
      '__pycache__',
      '.venv',
      'coverage',
    ];
  }

  public static get RunMaxParallelTest(): number {
    return 20;
  }

  /**
   * The GOPATH a run uses when the user has not set one.
   *
   * An empty GOPATH means the one Go finds by itself.
   */
  public static get DefaultGoPath(): string {
    return '';
  }

  /**
   * The path of the go binary a run uses when the user has not set one.
   *
   * An empty path means the one on the PATH.
   */
  public static get DefaultGoBinary(): string {
    return '';
  }

  /**
   * The flags that are added to the go test command when the user has not
   * set any.
   */
  public static get DefaultTestFlags(): string[] {
    return [];
  }

  /**
   * The build tags of a run when the user has not set any.
   */
  public static get DefaultBuildTags(): string {
    return '';
  }

  /**
   * The file that holds the environment variables of a run when the user has
   * not set one.
   */
  public static get DefaultEnvFile(): string {
    return '';
  }

  /**
   * The environment variables of a run when the user has not set any.
   */
  public static get DefaultEnv(): { [key: string]: string } {
    return {};
  }

  /**
   * Whether the `files.exclude` setting of the workspace also leaves paths out
   * of the tree, when the user has not said otherwise.
   */
  public static get DefaultUseFilesExclude(): boolean {
    return true;
  }

  /**
   * Whether a test file that holds no test function is listed, when the user
   * has not said otherwise.
   */
  public static get DefaultShowFilesWithoutTests(): boolean {
    return false;
  }

  /**
   * Whether the output of a run goes to a terminal when the user has not
   * said otherwise.
   */
  public static get RunInTerminal(): boolean {
    return true;
  }

  /**
   * The number of directories read at the same time while discovering test
   * files.
   */
  public static get DiscoveryConcurrency(): number {
    return 16;
  }

  /**
   * How long the tree waits, in milliseconds, before it redraws the tests
   * that finished while a run is going.
   *
   * The wait starts when the first test finishes and is not extended by the
   * ones that follow, so a result is never shown later than this. A run of
   * thousands of fast tests is redrawn a few times a second instead of once
   * per test.
   */
  public static get OutcomeRedrawDelay(): number {
    return 50;
  }

  /**
   * The most suites that are redrawn one by one when a batch of results is
   * shown. A batch that touched more suites redraws the whole tree once.
   */
  public static get OutcomeRedrawMaxSuites(): number {
    return 20;
  }

  /**
   * The most packages in one `go test` run when the user has not set a number.
   *
   * Zero means the number is not limited, and the packages are split only when
   * their arguments would be too long for a command line.
   */
  public static get DefaultMaxPackagesPerRun(): number {
    return 0;
  }
}
