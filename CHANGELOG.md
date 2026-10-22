# Change Log

## V0.3.0

### Added
- **Filter the tests.** A funnel button in the title of the test view opens one box for the whole filter: type words of a test or file name, and tick Failed, Passed or Not run. The tree follows the box as you type and tick. Enter keeps the filter and Escape puts back the previous one. While a filter is on, "Run All" and the run button of a file run only the tests that are shown, for example only the failed ones. The button turns into "Clear Filter". (#26, #15)
- **Collapse and expand.** One button in the title of the view collapses all the test files, and turns into one that expands them again.
- **Code coverage from the test view.** The shield button in the title of the view turns coverage on and offers to run all the tests. While it is on, every run from the view measures what the tests cover. (#31)
  - Lines the tests ran are marked green in the open editors, and lines they did not red. The marks are a line background and a mark in the overview ruler, so they do not compete with breakpoints in the gutter.
  - The share of the statements that ran is shown in the header of the view, where it stays in place while the tests are scrolled. It says "partial" until a "Run All" has produced it, and a spinner shows while tests are running.
  - Each test file shows its own coverage once its tests have run: the coverage of the file it tests (`a.go` for `a_test.go`), or of its package when there is no such file.
  - During "Run All" the coverage of each package is shown as soon as the package has finished, not when the whole run has.
  - The status bar shows the figure too. Click it for the covered files, the least covered first, and pick one to open it.
  - Running one test file or one test only adds to the coverage of the file it tests and never takes coverage back. "Run All" starts the coverage again, and saving a file forgets its coverage, because the marks would no longer be where the code is.
- The setting `goTestExplorer.showFilesWithoutTests` lists the test files that have no `Test` function. They are left out by default.
- **Choose what is loaded.** For a large workspace, three settings decide which paths are loaded into the tree. The tree follows them as soon as they change. (#6)
  - `goTestExplorer.includePaths`: the folders to load tests from, relative to the workspace folder (or absolute), for example `["api", "worker"]`. A listed folder that does not exist is reported. Empty, the default, loads the whole workspace folder, or its `src` folder when it has one.
  - `goTestExplorer.excludePaths`: glob patterns of the files and folders that are not loaded, for example `**/generated` or `third_party/**`. A folder that matches is not entered.
  - `goTestExplorer.useFilesExclude` (on by default): the `files.exclude` setting of the workspace also leaves paths out of the tree.
- The module cache of a GOPATH that lives inside the project (the `name@v1.2.3` folders) is no longer walked, so the tests of every downloaded module do not fill the tree. (#6)
- **Build tags.** The command "Set Build Tags..." in the menu of the test view (the three dots) asks for the tags that `go test` runs with (`-tags`), for example `functional,integration`, and keeps them in the settings of the workspace, as `goTestExplorer.buildTags`. The view shows the tags that are set. (#30)
- A test file that a build tag leaves out, such as one that starts with `//go:build functional` when that tag is not set, is shown as "needs build tags", with the constraint in its tooltip. It has no run button and no tests listed, and "Run All" does not run it, so its tests no longer show as passed without having run. Setting the tag brings the file back. Constraints in the older `// +build` form and in the name of a file (`_linux_test.go`) are read too. A constraint that depends on how the tool is run (`cgo`, `race`) is not decided, so its file is kept.

### Fixed
- A test file that has no `Test` function, such as a file of helpers that another test runs with `t.Run`, no longer looks like a test. Clicking it used to fail with "Could not find test (no symbols matching)", and its run button ran nothing and could report a pass. Such files are now left out of the tree, or shown as files marked "no tests", without a run button, when `goTestExplorer.showFilesWithoutTests` is on.

## V0.2.1

### Fixed
- A test file no longer keeps showing as running after all its tests have finished. It shows as passed, or failed if one test failed, as soon as its last test is done.
- A run that cannot start now ends as failed, with the reason, instead of showing as running for ever.
- "Run All" works on a module with a very large number of packages. When the package names would be too long for one command line, the module is tested in several runs, one after another.

### Changed
- The output kept for a test is limited to its first and last lines, with a line saying how many were left out: up to 1,000 lines per test. The terminal still shows every line as it arrives. This keeps a test that prints without end from using the memory of the editor.
- The tree is redrawn for several finished tests at once, instead of once for each test, so a run of many fast tests is smoother.

### Added
- The setting `goTestExplorer.maxPackagesPerRun` sets the most packages that one `go test` run tests when "Run All" tests a module. The default, `0`, means no limit on the number: a module is split only when its package names would not fit a command line.

## V0.2.0

Requires VS Code 1.85 or newer.

### Fixed
- Running a test suite no longer also runs tests whose name starts with the same text (for example `TestAlphaExtra` when only `TestAlpha` was asked for).
- Every test no longer fails with `invalid value "undefined" for flag -timeout` when `go.testTimeout` is not set. The timeout now defaults to `30s` and is shown in the output.
- The extension no longer stops running tests after a few runs have failed to start.
- Tests are discovered in every folder of a multi-root workspace, not only the first one.
- Test files are found on Windows.
- A run uses the environment and settings of the file under test, not of the file that happens to be focused.
- Test results are kept when the tree is refreshed.
- Running one test no longer starts it twice or shows a spinner that never stops.

### Changed
- Tests are discovered without the external `go-outline` tool, so nothing needs to be installed and the tree is no longer empty without it. Discovery of 500 test files went from about 250 ms to about 15 ms and starts no processes.
- The tree updates by itself when a `_test.go` file is saved, created or deleted. There is no need to refresh.
- Results are read from `go test -json`. A failing subtest marks its parent test as failed.
- The status of each test is shown as soon as that test finishes, instead of when the whole run is over.
- "Run All" tests all the packages of a module in one `go test` process, so they are compiled once.
- The output of a run is written to a terminal, with colours. Set `goTestExplorer.runInTerminal` to `false` to use an output channel instead.
- More folders are skipped when looking for tests: `node_modules`, `testdata`, `dist`, `build`, `out`, `third_party`, `proto`, `generated` and others. The list is the setting `goTestExplorer.skipFolders`.
- The refresh and cancel buttons use the built-in VS Code icons.

### Added
- "Cancel Test Run" stops a run, including the test binary it started. Ctrl+C in the output terminal does the same.
- Settings under `goTestExplorer.*`: `maxParallelTests`, `skipFolders`, `goPath`, `goBinary`, `testFlags`, `buildTags`, `timeout`, `envFile`, `env` and `runInTerminal`. A setting that is not set falls back to the matching `go.*` setting of the Go extension, so an existing setup keeps working. The Go extension is optional.

### Internal
- TypeScript 5, ESLint and Prettier, a bundled build, and a CI matrix on Ubuntu, macOS and Windows. The package went from about 944 KB to about 98 KB.

## V0.1.13
- Fixed "Run All" not running every test.

## V0.1.12
- Test flags are taken from the Go extension's configuration.

## V0.1.11
- Support the `go.testEnvFile` setting.

## V0.1.10
- Added error message notification for any error occur while discovering tests.

## V0.1.9
- Execute test per test suite with the help of go tools to improve performace.
- Update test suite icon based on the test result

## V0.1.8
- Changed extension's icon

## V0.1.7
- Added parallel test execution limit to improve extention performance

## V0.1.5
- Improved performance of test loader

## V0.1.4
- Run all test from test suite at right click
- Improved performance of loading test result 