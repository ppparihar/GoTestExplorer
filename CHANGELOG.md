# Change Log

## Unreleased

### Added
- Code coverage from the test view. The "Show Code Coverage" button (shield icon) in the title of the view turns it on, and offers to run all the tests at once. While it is on the view says so, and every run from the view measures what the tests cover. When a run ends the lines are marked in the open editors, green for lines the tests ran and red for lines they did not. The share of the statements that ran is shown in the header of the view, where it stays in place while the tests are scrolled (it says "partial" until a "Run All" has produced it, so it is clear when it is not the figure of the whole project). While tests are running a spinner shows beside it, so it is clear that it is about to change. Beside each test file there is its own coverage (the coverage of the file it tests, such as `a.go` for `a_test.go`, or of its package when there is no such file). The status bar shows the figure too. Click it for a list of the files, the least covered first, and pick one to open it. The button turns into "Hide Code Coverage", which removes the marks. Running one test file, or one test, only adds to the coverage of the file it tests and never takes coverage back, so the numbers do not move when other files are run; "Run All" starts the coverage again, and saving a file forgets its coverage, because the marks would no longer be where the code is. The marks are a line background and a mark in the overview ruler, so they do not compete with breakpoints in the gutter. (#31)
- A filter button (funnel icon) in the title of the test view. It opens one box for the whole filter: type words of a test or file name, and tick Failed, Passed or Not run. The tree follows the box as you type and tick (Enter keeps the filter, Escape puts back the previous one). "Run All" and the run button of a file then run only the tests that are shown, for example only the failed ones. The button turns into "Clear Filter" while a filter is on. The view also has one button that collapses all the test files, and turns into one that expands them again. (#26, #15)

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