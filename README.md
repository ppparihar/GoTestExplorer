# Go Test Explorer

Run and explore Go tests in a tree view inside Visual Studio Code.

![go-test-explorer](media/gotest.gif)

## Features
- Discover `*_test.go` files and functions without spawning external tools
- Run tests per file, per suite, or all tests in a module in one `go test` invocation
- Parse `go test -json` for accurate results and subtest failures
- Filter the tests by name and by status (failed, passed, not run); "Run All" then runs only what is shown
- Show code coverage for runs started from the view: covered and uncovered lines in the editor, the overall figure in the view header, and the coverage of each test file
- Build tags: set them from the view menu ("Set Build Tags..."); test files that the tags leave out are marked, and not run
- Load only the folders you work on in a large workspace (`includePaths`, `excludePaths`, and the workspace `files.exclude`)
- Cancel running tests (kills the process tree)
- Show test output in a terminal (with colors) or an output channel
- Respects `go.*` settings as fallback; configurable via `goTestExplorer.*`

## Requirements
- Go installed on `PATH` (or configured via `goTestExplorer.goBinary`/`goTestExplorer.goPath`)
- The [Go extension](https://marketplace.visualstudio.com/items?itemName=golang.go) is optional

## Configuration

All settings start with `goTestExplorer.`. Change them in the Settings UI (search for "Go Test Explorer"), or in `settings.json`. Put them in the workspace `.vscode/settings.json` to share them with your team, or in your user settings to use them everywhere.

A setting that you leave unset falls back to the matching `go.*` setting of the Go extension where there is one (marked below), so an existing Go setup keeps working. Without either, the default is used.

### Choose what is loaded

Use these in a large workspace, so the tree shows only the tests you care about.

| Setting | Default | What it does | Example |
| --- | --- | --- | --- |
| `includePaths` | `[]` | Load tests only from these folders, relative to the workspace folder (or absolute). Empty loads the whole workspace folder, or its `src` folder when it has one. A folder that does not exist is reported. | `["api", "worker/internal"]` |
| `excludePaths` | `[]` | Glob patterns of the files and folders that are not loaded, relative to the workspace folder. A folder that matches is not entered. | `["**/generated", "third_party/**"]` |
| `useFilesExclude` | `true` | Also leave out what the workspace `files.exclude` setting hides. | `false` to load folders you hide in the file explorer |
| `skipFolders` | `vendor`, `node_modules`, `.git`, `testdata`, `dist` and others | Folder names that are never entered, wherever they appear in the workspace. Your list replaces the default list, so include the defaults you still want. | `["vendor", ".git", "node_modules", "fixtures"]` |
| `showFilesWithoutTests` | `false` | List test files that have no `Test` function, such as files of helpers that another test runs. They are marked "no tests", and a click opens the file. | `true` |

The tree reloads by itself when you change one of these.

`skipFolders` matches a folder by its name, anywhere. `excludePaths` matches a path, so it can leave out one folder (`legacy/old`) without touching other folders of the same name. The module cache of a GOPATH inside the project (the `name@v1.2.3` folders) is never walked.

### How tests run

| Setting | Default | What it does | Example |
| --- | --- | --- | --- |
| `buildTags` | empty (falls back to `go.buildTags`) | The tags that `go test` runs with (`-tags`). Test files that these tags leave out, for example `//go:build functional`, are marked "needs build tags" and are not run. You can also set it from the view menu with "Set Build Tags...". | `"functional,integration"` |
| `testFlags` | `[]` (falls back to `go.testFlags`) | Flags added to the `go test` command. | `["-count=1", "-race"]` |
| `timeout` | `"30s"` (falls back to `go.testTimeout`) | The timeout of a test run (`-timeout`). | `"2m"` |
| `env` | `{}` (falls back to `go.testEnvVars`) | Environment variables of a test run. They win over the same key in `envFile`. A value can use `${workspaceFolder}` and `~`. | `{"APP_ENV": "test", "DB_URL": "postgres://localhost/test"}` |
| `envFile` | empty (falls back to `go.testEnvFile`) | A file of environment variables for a test run, one `KEY=value` per line. The path can use `${workspaceFolder}` and `~`. | `"${workspaceFolder}/.env.test"` |
| `maxParallelTests` | `20` | The most test runs that are in flight at the same time. | `4` on a small machine |
| `maxPackagesPerRun` | `0` (no limit) | The most packages that one `go test` run tests when "Run All" tests a module. By default a module is split only when its package names would not fit a command line. | `50` |

### Go tool and output

| Setting | Default | What it does | Example |
| --- | --- | --- | --- |
| `goBinary` | empty | The path of the `go` binary. Empty uses the one on `PATH`, or the one named in `go.alternateTools`. | `"/usr/local/go/bin/go"` |
| `goPath` | empty (falls back to the Go extension's GOPATH) | The GOPATH that the `go` tool runs with. | `"/home/me/go"` |
| `runInTerminal` | `true` | Write the output of a run to a terminal, with colors. When `false` it goes to an output channel instead. | `false` |

### An example

A large workspace where you only work on two packages, run the tests with the race detector, and need a tag for the functional tests:

```json
{
  "goTestExplorer.includePaths": ["services/orders", "services/billing"],
  "goTestExplorer.excludePaths": ["**/generated"],
  "goTestExplorer.buildTags": "functional",
  "goTestExplorer.testFlags": ["-count=1", "-race"],
  "goTestExplorer.timeout": "2m",
  "goTestExplorer.env": { "APP_ENV": "test" }
}
```

## Development
```bash
npm install
npm run compile
npm run lint
npm run test
npm run package
```

## License

[MIT](LICENSE)
