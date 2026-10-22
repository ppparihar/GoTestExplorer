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
			"vendor",
			".vscode",
			".git",
			".idea",
			"node_modules",
			"testdata",
			"dist",
			"build",
			"out",
			"third_party",
			"proto",
			"generated",
			"__pycache__",
			".venv",
			"coverage"
		];
	}

	public static get RunMaxParallelTest(): number {
		return 20;
	}

	/**
	 * The number of directories read at the same time while discovering test
	 * files.
	 */
	public static get DiscoveryConcurrency(): number {
		return 16;
	}
}
