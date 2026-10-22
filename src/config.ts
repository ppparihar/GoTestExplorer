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
}
