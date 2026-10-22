# Go Test Explorer — Optimization Plan

Status: proposed · Target: `master` (v0.1.13) · Scope: performance, correctness, maintainability, UX

---

## 1. Executive summary

The extension works, but it is built on a 2018-era architecture and has three classes of problems:

1. **It silently does nothing for most users.** Test discovery depends on an external binary, `go-outline`, which is not installed by default. When it is missing, the extension shows an empty tree and no error — every test file resolves to zero symbols. The user gets a blank panel with no explanation. (Verified: `go-outline` is not present on this machine, and `src/lib/goOutline.ts:67` resolves `null` on failure.)

2. **Discovery is O(files) process spawns.** Every `_test.go` file costs one `go-outline` process spawn, one document open, one full-file read, one UTF-8 re-encode, and one AVL-tree build. A 200-file repo means 200 process spawns — all fired at once with no concurrency cap.

3. **Results can be wrong, and the runner can permanently wedge.** The `-run` regex is mis-anchored, so running a suite also runs unrelated tests. Three separate error paths leak the parallel-run counter, and after 20 leaks the extension stops running tests forever with no error.

Everything else — ancient TypeScript, dead code, no real tests, no CI — compounds the cost of fixing these.

**The plan below fixes correctness first (cheap, high blast radius), then removes the two structural bottlenecks (external process per file, per-test tree refreshes), then modernizes the toolchain.** A native VS Code Testing API migration is scoped as an optional final phase because it is the largest possible win but also the largest diff.

---

## 2. Verified findings

Every finding below was confirmed by reading the code and reproducing the behaviour against Go 1.27.

### 2.1 Correctness

The `Location` column records where each finding was when it was made. Some of
those files have since been deleted (Phase 2 removed `src/lib/goOutline.ts`,
`src/lib/avlTree.ts`, `src/fileSystemProvider.ts` and `src/entry.ts`), so a
location that points at a deleted file is a record of the past, not a place to
look now.

| # | Finding | Location | Evidence |
|---|---|---|---|
| C1 | `-run` regex is mis-anchored. `util.format('^%s$', fns.join('\|'))` yields `^A\|B$`, which parses as `(^A)\|(B$)`. Running a suite therefore also runs `TestAlphaExtra` when the suite only asked for `TestAlpha`. | `src/lib/testUtil.ts:262` | Reproduced: `go test -run '^TestAlpha\|TestGamma$'` executed `TestAlphaExtra`; the correct form `^(A\|B)$` did not. |
| C2 | Parallel-run counter leak. `this.count--` is only reached on the success path; a rejected or `undefined` result throws before it. After 20 leaks `count > RunMaxParallelTest` is permanently true and **the extension never runs a test again**, silently. | `src/goTestExplorer.ts:84-105` | `await runGoTest(...)` at line 90; `this.count--` at line 91 is not in a `finally`. |
| C2a | Leak path A: `runGoTest` resolves `undefined` when the `go` binary is not found → `result.isPassed` throws `TypeError`. | `src/lib/testUtil.ts:146-149` → `src/goTestExplorer.ts:96` | `return Promise.resolve();` inside the executor resolves the outer promise with `undefined`. |
| C2b | Leak path B: any synchronous throw inside the `new Promise` executor rejects the promise → unhandled rejection at the `await`. | `src/lib/testUtil.ts:115` | No `try/catch`/`finally` around the `await`. |
| C3 | Parallelism off-by-one: `count > Config.RunMaxParallelTest` admits 21 concurrent runs, not 20. | `src/goTestExplorer.ts:85`, `src/config.ts:6` | Guard should be `>=`. |
| C4 | `go.testTimeout` unset → `args.push('-timeout', undefined)` → Node coerces to the string `"undefined"` → `go test` exits 2 with `invalid value "undefined" for flag -timeout`. **Every test fails** when the `golang.go` extension is absent or the setting is unset. | `src/lib/testUtil.ts:135` | Reproduced: `go test -timeout undefined` → `invalid value "undefined" for flag -timeout`. |
| C5 | `flags: [""]` pushes an empty positional package argument into `go test`. | `src/goTestExplorer.ts:70` → `src/lib/testUtil.ts:129` | `go test ''` currently succeeds in module mode, so this is latent rather than active — but it is wrong and breaks in GOPATH mode. |
| C6 | Missing `go-outline` produces a **silent empty tree**: `documentSymbols` resolves `null`, `convertToCodeSymbols` does `(decls \|\| [])`, so zero symbols — no error, no tree. `promptForMissingTool` also fires **once per file**, so a 200-file repo produces 200 toasts. | `src/lib/goOutline.ts:66-82`, `src/lib/goOutline.ts:154`, `src/lib/goOutline.ts:118` | `go-outline` not installed locally; resolution path confirmed by inspection. |
| C7 | Multi-root workspaces: only the **first** workspace folder is scanned. | `src/testDiscovery.ts:17` | `.filter(...)[0]` |
| C8 | Windows path bug: `path.join(workspaceFolder.uri.path, "src")` uses `.path` (URL form), not `.fsPath`. | `src/testDiscovery.ts:18` | — |
| C9 | Running one test fires `sendTestRunStarted` twice and creates a phantom `TestNode` that is not in the discovered map, so `setLoading` no-ops (spinner never appears) and an extra tree refresh is triggered. | `src/goTestExplorer.ts:42-45`, `src/goTestProvider.ts:98-104` | — |
| C10 | Test results are discarded on refresh: `onDiscoverTestStart` empties the list and `onDicoveredTest` rebuilds nodes from scratch. | `src/goTestProvider.ts:72-94` | — |
| C11 | Environment/config for a test run is resolved from the **focused editor**, not the file under test — so running a test in file A while file B is focused uses B's `go.testEnvVars`/`toolsEnvVars`. | `src/lib/utils.ts:105` vs `src/lib/testUtil.ts:143` | `getToolsEnvVars()` reads `vscode.window.activeTextEditor.document.uri`; the config passed in is scoped to `testNode.uri`. |
| C12 | Greedy path regex `^\s*(.+.go):(\d+):` can match the wrong file in a line containing two paths. | `src/lib/testUtil.ts:240` | — |

### 2.2 Performance

| # | Finding | Location | Cost |
|---|---|---|---|
| P1 | **One `go-outline` process spawn per test file.** Plus a document open, a full-file `getText()`, a `new Buffer(...)` UTF-8 re-encode, and an AVL tree build per file. | `src/testDiscovery.ts:32-38` → `src/lib/testUtil.ts:60-70` → `src/lib/goOutline.ts:148-159`, `src/lib/goOutline.ts:64` | 200 test files ⇒ 200 spawns + 200 doc opens + 200 re-encodes + 200 tree builds. **Dominant cost.** |
| P2 | Discovery fires all file scans at once — unbounded concurrency. | `src/testDiscovery.ts:31-38` (`Promise.all` over all files) | Machine thrash on large repos; N simultaneous spawns. |
| P3 | **N+1 stat calls.** `_readDirectory` issues one `fs.stat` per entry and `await`s them **sequentially**. | `src/fileSystemProvider.ts:194-205` | One serialized syscall per file in the tree. `fs.readdir(dir, {withFileTypes:true})` collapses this to one call per directory. |
| P4 | Skip list is only `vendor`, `.vscode`, `.git`. | `src/config.ts:3` | `node_modules`, `testdata`, `dist`, `build`, `out`, `third_party`, `proto`, `generated` are all walked. `testdata` is a Go convention that must be skipped. |
| P5 | **One tree refresh per test result.** `onDidChangeTreeData.fire` runs for every individual test result. | `src/goTestProvider.ts:64-71` | An N-test suite triggers N full tree re-renders. |
| P6 | No result cache, no incremental discovery, no file watcher. Every "Refresh" redoes the whole pipeline. | `src/goTestExplorer.ts:28-30`, `src/testDiscovery.ts:15` | — |
| P7 | Quadratic string handling in output capture: `LineBuffer.append` does `buf += chunk` then `substring` per line; `expandFilePathInOutput` re-splits the whole string per chunk. | `src/lib/utils.ts:178-189`, `src/lib/testUtil.ts:237-246` | O(n²) on large test output. |
| P8 | "Run All" spawns one `go test` per package. | `src/goTestExplorer.ts:58-62` | Each pays a separate compile+link. A single `go test ./...` amortizes the build. |
| P9 | No cancellation. `runningTestProcesses` is tracked but never exposed. | `src/lib/testUtil.ts:16`, `src/lib/testUtil.ts:217-220` | A hung test cannot be stopped. |
| P10 | Byte-offset conversion machinery exists only because `go-outline` reports byte offsets. | `src/lib/utils.ts:153-172`, `src/lib/avlTree.ts` (262 lines) | A line/character-based scanner removes the need and deletes `avlTree.ts`. |

### 2.3 Tooling and maintainability

| # | Finding | Location |
|---|---|---|
| T1 | TypeScript 2.6.1, `@types/node` ^8, `vscode` dev-dep ^1.1.21, `engines.vscode: ^1.26.0`. Six years stale — the native Testing API, modern `Terminal`, and glob file watchers are all unavailable. | `package.json:8,129-136` |
| T2 | `npm test` only compiles. The one "test" asserts `-1 === [1,2,3].indexOf(5)`. `src/test/index.ts` imports the removed `vscode/lib/testrunner`. | `package.json:125`, `src/test/extension.test.ts:15-21`, `src/test/index.ts:13` |
| T3 | tslint 5.8 (unmaintained since 2019), 6-rule config, `defaultSeverity: warning` — does not fail a build. No ESLint, no Prettier. | `tslint.json` |
| T4 | CI is a Travis config plus a lone CodeQL workflow. No build/lint/test/package job matrix. | `.travis.yml`, `.github/workflows/codeql-analysis.yml` |
| T5 | Dead weight: `src/fileSystemProvider.ts` implements write/delete/rename/watch for a provider that is **never registered**; `mkdirp` + `rimraf` exist only for those unused paths; `getToolsGopath`, `resolveHomeDir`, `stripBOM` are duplicated across `src/lib/utils.ts` and `src/lib/goPath.ts`. | `src/fileSystemProvider.ts`, `package.json:138-141`, `src/lib/utils.ts:9,66,130` vs `src/lib/goPath.ts:100,105` |
| T6 | No `contributes.configuration` — every knob is hardcoded. No `extensionDependencies` on `golang.go` despite depending on its settings (and breaking without them, see C4). | `package.json:23-119`, `src/config.ts` |
| T7 | README is 4 lines; marketplace metadata is minimal (description `"Go Test Explorer"`, `categories: ["Other"]`). | `README.md`, `package.json:5,16-18` |
| T8 | `tsc` output is shipped un-bundled (`main: ./out/extension`) — the whole `node_modules` goes into the VSIX. | `package.json:22,131`, `.vscodeignore` |

---

## 3. Target architecture

```
                    ┌──────────────────────────────────────────┐
                    │  Discovery                                │
  workspace ───────▶│  go list -json ./...   (module-aware)    │
                    │     │                                    │
                    │     ├─▶ package scan (Go source scanner)  │  no process spawn
                    │     │     └─ file cache (path+mtime+size)  │
                    │     └─▶ fallback FS walk (withFileTypes)  │
                    └──────────────────────────────────────────┘
                                     │  TestNode tree
                    ┌────────────────▼─────────────────────────┐
                    │  Runner                                  │
                    │  bounded concurrency (configurable)       │
                    │  go test -json  →  structured events     │
                    │  CancellationToken support                │
                    │  batched tree refresh (1 per package)     │
                    └──────────────────────────────────────────┘
```

Three structural changes carry most of the win:

1. **No external process per file.** A small in-process Go scanner extracts `func Test*` declarations (name + line + character range). This removes the `go-outline` dependency *and* the largest cost *and* the install friction — three problems, one fix. A `go list -json ./...` pass supplies module-aware package discovery (respects build tags, skips `vendor`/`testdata` automatically) with an FS-walk fallback when `go` is unavailable.

2. **`go test -json` instead of regex scraping.** Go emits structured events:
   ```json
   {"Action":"fail","Package":"probe","Test":"TestGamma/sub1","Elapsed":0}
   {"Action":"fail","Package":"probe","Test":"TestGamma","Elapsed":0}
   {"Action":"pass","Package":"probe","Test":"TestAlpha","Elapsed":0}
   ```
   This gives per-test pass/fail/skip, real durations, subtest attribution, build-failure detection, and panic handling — with no fragile regex. It also makes the `-run` anchoring fix (C1) verifiable in tests.

3. **Batched refreshes + a result cache.** One `onDidChangeTreeData.fire` per completed package instead of per test; discovery results cached by `(path, mtime, size)` and refreshed incrementally by a `FileSystemWatcher` on `**/*_test.go`.

---

## 4. Phased work plan

Each phase is independently shippable and independently verifiable.

### Progress

| Phase | Status | Evidence |
|---|---|---|
| Phase 0 — Baseline and test harness | Done | `npm test` runs 179 assertions across 12 files; `npm run bench` writes `bench/results/baseline.json` |
| Phase 1 — Correctness fixes | Done | C1–C12 applied; each fix has a regression test in `src/test/` |
| Phase 2 — Discovery performance | Done | `go-outline` removed; discovery is in-process; 500-file fixture: 246 ms → 15 ms, 500 spawns → 0; a refresh over a warm cache costs 3.6 ms and a saved file reaches the tree without a manual refresh |
| Phase 3 — Execution performance | In progress | 3a–3d done: the run is parsed from the `go test -json` event stream, the `-run` anchoring is proven against the real toolchain, the tree is redrawn once per run instead of once per test, and a run can be cancelled — the whole process tree included |
| Phase 4 — Toolchain and delivery | Partially done | TypeScript 5, `@types/vscode` 1.85, Vitest, `tsx` landed as Phase 0 prerequisites; the rest of Phase 4 is still open |
| Phase 5 — Native Testing API | Not started | Deferred |
| Phase 6 — Feature parity | Not started | Deferred |

**Deviations from the plan.** The test harness uses Vitest with a local
`vscode` mock (`src/test/mocks/vscode.ts`) rather than `@vscode/test-cli` +
`@vscode/test-electron`: the unit tests target pure logic and the extension's
own modules, and downloading an extension host per run is not needed for that.
The bench harness resolves `vscode` through `bench/tsconfig.runtime.json`
(`paths` mapping) rather than a runtime resolver patch.

**Phase 2 deviations.** 2b was implemented as a **filesystem walk only**; the
`go list -json ./...` variant was rejected because it spawns a process, which
is exactly what Phase 2 exists to remove, and because it silently drops test
files that a build tag excludes, which would make the tree disagree with what
`go test` runs. The consequence is that discovery lists a *superset* of the
files the toolchain will build: a `_test.go` file behind a build tag shows up
in the tree and `go test` reports no tests for it. The planned
`go test -list` fallback for low-confidence scans was dropped for the same
reason — it spawns a process. Instead the scanner reports its confidence and
discovery logs the files it could not parse.

**Baseline recorded on 2026-10-22** (20 packages x 20 tests, macOS/arm64,
Node 24.14.0, Go 1.27.1). The full record is `bench/results/baseline.json`.

| Measurement | First run | Warm |
|---|---|---|
| Discovery (20 files, 400 tests) | 21 ms | 12 ms |
| `go test ./...` (20 packages) | 179 ms | 81 ms |

"First run" is the first measurement in a process; "warm" is the second. The
`go` build cache was already populated, so the "first run" figure excludes the
cost of compiling the fixture from scratch.

**Phase 2 measured on 2026-10-22** (same machine, same fixture generator).
The Phase 0 column is the `go-outline` path measured by spawning one
`go-outline -f <file>` per test file at concurrency 8 — the cost model the
extension had before Phase 2.

| Measurement | Phase 0 | Phase 2 | Change |
|---|---|---|---|
| Discovery, 20 files / 400 tests (first run) | 21 ms | 4.1 ms | 5.1× faster |
| Discovery, 20 files / 400 tests (warm) | 12 ms | 1.2 ms | 9.9× faster |
| Discovery, 500 files / 10,000 tests | 246 ms | 15 ms | **16× faster** |
| Discovery, 500 files, warm cache | 246 ms | **3.6 ms** | **68× faster** |
| Child processes spawned, 500 files | 500 | **0** | — |
| Tests found, 500 files | 10,000 | 10,000 | same |
| `go test ./...` (20 packages, warm) | 81 ms | 80 ms | unchanged |

Both paths find the same 10,000 tests in the 500-file fixture, so the speed-up
is not bought by finding fewer of them.

The **warm cache** row is Phase 2c: the second discovery over files that have
not changed, which is what a refresh of the tree costs. It stats every file
and reads none of them, so it is 3.5× faster than the 12.4 ms of an uncached
refresh and 68× faster than Phase 0. On the 20-file fixture the cache is
break-even (1.5 ms against 1.3 ms), because 20 `stat` calls cost about as much
as 20 reads of a file that holds twenty tests. The cache earns its keep on a
repository of any size.

---

### Phase 0 — Baseline and test harness *(prerequisite)*

Nothing can be called "faster" or "fixed" without a way to measure and to test it.

- Add a `bench/discovery-bench.ts` script that runs discovery against a fixture repo of N generated test files and reports: wall time, files discovered, processes spawned.
- Add a `bench/exec-bench.ts` that runs a package of M tests and reports wall time.
- Wire up a real test runner: `@vscode/test-cli` + `@vscode/test-electron`, with Vitest (or `node:test`) for pure-logic units (scanner, `-json` parser, path/config helpers).
- Add a fixture repo generator (`bench/fixtures/gen.ts`) producing 50/200/500-file Go repos so the numbers are comparable across phases.

**Exit criteria:** `npm run bench` prints a table; `npm test` runs >0 real assertions and fails on a broken assertion.

**Effort:** ~1 day.

---

### Phase 1 — Correctness fixes *(highest value, lowest risk)*

Fix every item in §2.1. No architecture changes — these are surgical.

| Fix | Change |
|---|---|
| C1 | `src/lib/testUtil.ts:262` → `params = ['-run', util.format('^(%s)$', testFunctions.join('|'))]`. Add a unit test asserting the emitted flag for a multi-function suite. |
| C2 | Wrap the `await runGoTest(...)` in `try/catch/finally` in `src/goTestExplorer.ts:84-105`; decrement `count` in `finally`; convert a thrown error into a failed `RawTestResult` rather than letting it escape. |
| C2a | `src/lib/testUtil.ts:146-149` → resolve a real `new RawTestResult(false, [], err)` instead of `undefined`. |
| C2b | Same `try/catch` as C2. |
| C3 | `src/goTestExplorer.ts:85` → `this.count >= Config.RunMaxParallelTest`. |
| C4 | `src/lib/testUtil.ts:135` → only push `-timeout` when the value is a non-empty string; default to `30s`; surface the effective value in the output channel. |
| C5 | `src/goTestExplorer.ts:70` → `flags: []`. |
| C6 | Detect a missing `go-outline` **once** at discovery start and show a single actionable message (offer to install / explain that discovery is unavailable), instead of N toasts and a silent empty tree. *(Short-term only — Phase 2 removes `go-outline` entirely.)* |
| C7 | `src/testDiscovery.ts:17` → iterate **all** workspace folders. |
| C8 | `src/testDiscovery.ts:18` → use `.fsPath`. |
| C9 | `src/goTestExplorer.ts:42-45` → drop the phantom suite node and the duplicate `sendTestRunStarted`. |
| C10 | Preserve results across refresh: carry `testResult`/`isLoading` from the old node map into the rebuilt nodes. |
| C11 | `src/lib/utils.ts:104-128` → `getToolsEnvVars(workspaceUri?)`; thread the test file's URI through from `src/lib/testUtil.ts:143`. |
| C12 | `src/lib/testUtil.ts:240` → anchor the file-path group non-greedily: `/^\s*(\S+\.go):(\d+):/`. |

Also add a `go` binary preflight in `activate()` so a missing toolchain fails loudly and early instead of at first run.

**Exit criteria:**
- A test asserting `-run` for a 2-test suite is exactly `^(TestA|TestB)$`.
- A test that forces `runGoTest` to reject shows the runner continues to work afterwards (no counter leak).
- A test with `go.testTimeout` unset shows the run succeeds with a default timeout.
- Manual: multi-root workspace shows tests from every folder.

**Effort:** ~2 days.

---

### Phase 2 — Discovery performance *(the big one)*

**2a. In-process Go source scanner** — `src/discovery/goScanner.ts` — **Done**

Replaces `getTestFunctions`/`go-outline` with a scanner that reads the file once and finds top-level `func TestXxx(...)` declarations, returning `{ name, line, startChar, endChar, usesTesting }`.

It correctly skips:
- line comments `//` and block comments `/* ... */`
- interpreted strings `"..."` with escapes
- raw strings `` `...` ``
- rune literals `'{'`
- method receivers (`func (t *T) TestX()` → not a test)
- nested declarations and function literals
- generic functions (`func TestXxx[T any](t *testing.T)`)

Rationale for a scanner over `go list`/`go test -list`: `go test -list` requires building the test binary (slow first run, though the Go build cache amortises it) and gives only names, not positions. `go-outline` requires an external binary. The scanner needs no toolchain at all and gives exact source positions for go-to-location.

> **Risk:** a hand-rolled scanner can mis-parse exotic Go. Mitigation: a fixture corpus of tricky Go files (generics, raw strings containing `func Test`, comments with braces, build tags, cgo) with golden-output unit tests; plus a **fallback** to `go test -list` when the scanner's confidence is low.

**Done, with the fallback dropped.** `src/test/goScanner.test.ts` holds 34 cases over the tricky-Go corpus, including a name inside a comment, a name inside an interpreted string, a name inside a raw string, a name inside a struct tag, a method with a receiver, a nested declaration, a function literal, a generic function, a multi-line parameter list, and an escaped rune literal. The scanner reports `confident: false` with a reason for an unterminated literal, an unterminated block comment, or unbalanced braces; discovery logs those files instead of failing the refresh. The planned `go test -list` fallback was dropped because it spawns a process — see the Phase 2 deviations above.

**2b. Package discovery** — `src/discovery/fileWalker.ts` — **Done (FS walk only)**

- `go list -json ./...` respects modules, `go.work`, build tags, and skips `vendor`/`testdata` automatically.
- Fallback: recursive `fs.readdir(dir, {withFileTypes: true})` — one syscall per directory, replacing the N+1 `fs.stat` loop in `src/fileSystemProvider.ts:194-205`.

**Done as the FS walk only.** `findTestFiles()` walks the tree with `readdir({withFileTypes: true})`, skipping `Config.SkipFolders` by name at any depth, following symlinked directories while tracking real paths so a symlink cycle cannot loop forever, and ignoring broken symlinks. A symlinked directory keeps the path under the workspace, so the file the user opens is the one the tree shows. `go list` was not used: it spawns a process, and it drops test files that a build tag excludes, which would make the tree disagree with what `go test` runs.

**2c. Concurrency + skip list + cache + watcher** — **Done**

- Bound discovery concurrency to 16 (configurable). **Done** — `Config.DiscoveryConcurrency`, applied to both the directory walk and the file scans.
- Expand `Config.SkipFolders` (`src/config.ts:3`): `vendor, .vscode, .git, .idea, node_modules, testdata, dist, build, out, third_party, proto, generated, __pycache__, .venv, coverage`. **Done**.
- Cache scan results by `(path, mtime, size)`; re-scan only changed files. **Done** — `src/discovery/scanCache.ts` holds the declarations of each file together with the modification time and size it was read at. A file is read and parsed again only when one of those has changed, so a refresh costs one `stat` per file instead of one read. The watcher invalidates a file the moment it changes, so an edit is never hidden by a stale entry even on a file system with a coarse modification time.
- `vscode.workspace.createFileSystemWatcher('**/*_test.go')` → incremental add/remove instead of full rediscovery. **Done** — `TestDiscovery` watches the workspace and rescans only the file that changed. The tree node for that file is replaced in place, so the rest of the tree is not rebuilt and the outcome of tests that have already run is carried over, exactly as a full refresh does.

The watcher applies the same scope rules as the walk: a file outside the directory that is scanned (a folder with a `src` directory is scanned from there) or inside a skipped folder is ignored, so the tree does not gain a file the walk would not have found. A change that arrives while a discovery is running is applied once that discovery has finished, so an edit made during the first scan is not lost.

**2d. Retire the dead scaffolding** — **Done**

- Delete `src/fileSystemProvider.ts` (write/delete/rename/watch paths unused; the provider is never registered). **Done.**
- Delete `src/lib/avlTree.ts` (262 lines) once the scanner returns line/char offsets. **Done.**
- Delete `src/lib/goOutline.ts` (the `go-outline` integration). **Done.**
- Drop the `mkdirp` and `rimraf` dependencies. **Done.**
- De-duplicate `getToolsGopath` / `resolveHomeDir` / `stripBOM` across `src/lib/utils.ts` and `src/lib/goPath.ts`. **Done** — each helper is defined exactly once: `getToolsGopath` in `src/lib/utils.ts`, `resolveHomeDir` and `stripBOM` in `src/lib/goPath.ts`, which `utils.ts` imports. The duplicates were in the upstream initial commit but had already gone before this work started, so the premise of this item was stale. The helpers that did exist for `go-outline` (`makeMemoizedByteOffsetConverter`, `getFileArchive`, `getTestFunctions`, `Entry`) were removed.

**Exit criteria:**
- Discovery on the 500-file fixture: **no child processes spawned**, and wall time under the Phase 0 baseline by a measured margin (target: ≥10× faster; the baseline number goes in the plan's appendix). **Met** — 0 spawns, 246 ms → 15 ms, 16× faster.
- `go-outline` uninstalled → discovery still works fully. **Met** — the binary is no longer used by any code path; `src/test/testDiscovery.test.ts` proves discovery works with no external tool, and `npm run bench` no longer requires `go-outline` on `PATH`.
- Editing a `_test.go` file updates the tree within ~1s without a manual Refresh. **Met** — the file watcher rescans the file that changed and replaces its node in place. `src/test/testDiscovery.test.ts` covers a change, a creation and a deletion; `src/test/goTestProvider.test.ts` covers the tree update. The watcher fires when the file is written on disk, so the tree shows the saved file; an unsaved edit is still found by go-to-location, which reads the open document.

**Effort:** ~4 days.

**Phase 3 deviations.** `go test -json` implies verbose test-binary output, so
the output channel now carries the whole run (`=== RUN`, `--- PASS`, and the
rest) instead of only the failing tests. The result keeps the whole output too,
so "show test output" shows the run rather than a fragment of it. The toolchain
reports a failure for the parent of a failed subtest itself, so the descendant
rule is a backstop rather than the main path; it is implemented and tested
anyway, so the guarantee does not depend on the toolchain. A subtest that calls
`os.Exit(1)` produces no per-test event at all, only a package-level failure —
the extension then reports every requested test as failed, which is the safe
answer.

---

### Phase 3 — Execution performance and correctness

**3a. `go test -json` result parsing** — new `src/exec/goTestJsonParser.ts` — **Done**

Replace the `--- FAIL:` regex (`src/lib/testUtil.ts:173-183`) with a streaming JSON-event parser. Handle: `run`/`pass`/`fail`/`skip`/`output`/`build-fail`/`panic`. A test fails if it or any descendant (`Test/sub`) fails.

**Done.** `src/exec/goTestJsonParser.ts` reads the stream as it arrives: `write(chunk)` returns the output and the build output it saw, `end()` closes the stream and returns the results (the tests, the failed tests, the output, the build output). The `--- FAIL:` regex and the output buffer it fed are gone. The events handled are `run`, `pass`, `fail`, `skip`, `output`, `build-output`, `build-fail` and `start`; there is no `panic` action — a panic arrives as a `fail` with the panic text as output. The build error arrives on stdout *inside* the JSON stream, so it is separated from the output of the tests and leads the result, and a build failure produces no per-test events, which leaves the failed-test list empty and marks every requested test as failed. The descendant rule is `hasFailed(failedTests, name)`: a test failed when it failed, or when any failed test is named `name/...`.

The fixtures in `src/test/fixtures/` are the captured output of the real toolchain (Go 1.27.1), not hand-written JSON.

**3b. `-run` anchoring (carried from C1) is now provable** via a unit test over the emitted JSON — **Done**

`src/test/runGoTest.test.ts` runs the real toolchain against a fixture module: with `TestPassing`, `TestPassingExtra` and `TestOther` in one file, a run of `TestPassing` and `TestOther` must not run `TestPassingExtra`. The test reads the emitted JSON and asserts the names that ran. Reverting the regex to the ungrouped alternation `^TestPassing|TestOther$` — which parses as `(^TestPassing)|(TestOther$)` — makes the test fail, so the anchoring is proven rather than asserted.

**3c. Batched tree refresh** — `src/goTestProvider.ts:64-71` — **Done**

Collect results per package and fire `onDidChangeTreeData` **once** when the package completes.

**Done.** The tree was redrawn once per test result, and once per test that
started running, so a suite of twenty tests redrew the tree more than forty
times. Now the tests of a run are reported in one event, the outcome of each
test is applied to its node as it arrives, and the tree is redrawn once when
the run has finished — for the node that holds the tests, so only that part of
the tree is redrawn. `testCompleted` carries the URI of the file whose run
finished, which is what the redraw is aimed at.

**3d. Cancellation** — `src/lib/testUtil.ts:16` exposes `runningTestProcesses`; wire a "Cancel Test Run" command and `CancellationToken` support, killing the child process tree. — **Done**

**Done.** The command `goTestExplorer.cancelTestRun` (in the title bar of the
tree, next to "Run All") drops the invocations that have not started yet
(`TestQueue.cancel()`) and kills the ones that are running
(`cancelRunningTests()`); it says "No test run is in progress." when there is
nothing to stop. `runGoTest` takes a `CancellationToken` and kills the run when
it is cancelled.

The whole **process tree** is killed, not only the `go` process: the tool runs
the test binary as a child, and that binary would keep running — holding the
build cache and whatever it listens on — if only its parent were killed. The
child is therefore spawned detached, so it leads its own process group, and the
group is killed with a negative pid. On Windows, which has no process groups,
`taskkill /T /F` walks the tree instead. A detached child also outlives the
extension host, so `deactivate()` stops the runs that are still going when the
window closes.

**3e. Single process for "Run All"**

Where the selection spans multiple packages, run one `go test ./...` (or one `go test <pkgs>`) instead of one process per package — one compile pass instead of N.

**3f. Output handling**

- Replace `LineBuffer` (`src/lib/utils.ts:173-210`) with a chunk-array + index implementation → O(n) instead of O(n²).
- Replace the `expandFilePathInOutput` full-string resplit (`src/lib/testUtil.ts:237-246`) with per-line handling.
- Move output to a `vscode.Terminal` (with `go test` output decorations) instead of an output channel; the Terminal API gives cancellation and a real scrollback for free.

**3g. Configuration**

Add `contributes.configuration` for: `maxParallelTests`, `skipFolders`, `goPath`/`goBinary`, `testFlags`, `buildTags`, `timeout`, `envFile`, `env`, `runInTerminal`. Read `go.*` settings from the Go extension as a **fallback**, with the extension's own settings taking precedence, and validate that `go.testTimeout` is present (C4).

**Exit criteria:**
- A subtest failure marks its parent test failed. **Met** — the failed test is `TestAlpha/sub` and `TestAlpha` is reported as failed; `src/test/goTestExplorer.test.ts` covers it.
- "Run All" across 10 packages spawns **1** `go test` process. **Open** — 3e.
- A test run can be cancelled from the UI. **Met** — the "Cancel Test Run" command drops the runs that have not started and kills the ones that are running, and the whole process tree dies with them; `src/test/runGoTest.test.ts` proves that the test binary is gone after a cancellation, and `src/test/testQueue.test.ts` covers the queue.
- The tree re-renders once per package, not once per test. **Met** — a suite of twenty tests redraws the tree once, when the run finishes; `src/test/goTestProvider.test.ts` counts the redraws.

**Effort:** ~4 days.

---

### Phase 4 — Toolchain and delivery

| Item | Change |
|---|---|
| TypeScript | 2.6 → 5.x; `strict: true`; `noImplicitAny`; `noUnusedLocals`; `noUnusedParameters` |
| VS Code API | `@types/vscode` ^1.85+; `engines.vscode: ^1.85.0` |
| Bundling | esbuild → single `dist/extension.js`; keeps the VSIX small and install fast (fixes T8) |
| Lint / format | Replace tslint with ESLint (flat config) + Prettier; `npm run lint` fails the build (fixes T3) |
| Tests | `@vscode/test-cli` + `@vscode/test-electron`; Vitest for units (fixes T2) |
| CI | GitHub Actions matrix: node 18/20/22 × ubuntu/macos/windows → `lint`, `test`, `package`, `vsce publish --dry-run`; keep CodeQL |
| Package | `extensionDependencies`/graceful degradation for `golang.go`; proper `categories`, `keywords`, `description`, screenshots, `LICENSE` (fixes T6, T7) |
| Docs | Rewrite `README.md` (install, configure, troubleshoot); continue `CHANGELOG.md` per release |

**Exit criteria:** `npm run lint && npm test && npm run package` all green on the CI matrix; VSIX size drops materially; `vsce publish --dry-run` succeeds.

**Effort:** ~3 days.

---

### Phase 5 — Optional: migrate to the VS Code native Testing API

VS Code's built-in Testing API (`vscode.TestController`, VS Code ≥ 1.59) replaces the hand-rolled `TreeDataProvider` with the platform's own Test panel.

**Gains:** VS Code handles tree rendering, filtering, run/debug profiles, continuous run, and the Problems/Coverage panels; the extension's own tree code largely disappears; better perceived performance and accessibility for free; a maintained UI instead of a custom one.

**Costs:** a substantial rewrite of `src/goTestProvider.ts` and `src/testNode.ts`; some currently-available UI affordances (the custom icons, the bespoke right-click menu) change; the custom tree can be kept behind a setting during the transition.

**Recommendation:** do Phases 0–4 first. They are independently valuable and lower-risk, and they remove the correctness landmines that would otherwise be carried into the rewrite. Re-evaluate Phase 5 afterwards with real usage data; it should not block the fixes above.

---

### Phase 6 — Feature parity and polish (post-stabilisation)

- **Code coverage** — `go test -coverprofile` feeding the VS Code Coverage panel.
- **Benchmarks** — `func Benchmark*` discovery and a separate run profile.
- **Test filters** — `-short`, `-run` regex, `-tags` from the UI.
- **Per-test duration** and **flaky-test detection** (from the JSON events' `Elapsed`).
- **Persist results** across reloads via `workspaceState`.
- **First-class `go.work` support**.
- **Non-Go binaries** — the scanner approach generalises; a `go test` adapter interface would allow other runners later.

---

## 5. Effort and impact summary

| Phase | Effort | Impact | Risk |
|---|---|---|---|
| 0 — Baseline & harness | 1 day | Enables measurement of everything else | Low |
| 1 — Correctness | 2 days | Fixes wrong results + the silent-wedge bug | Low |
| 2 — Discovery perf | 4 days | Removes `go-outline`; largest single win | Medium (scanner correctness) |
| 3 — Execution perf | 4 days | Structured results, batching, cancellation | Medium |
| 4 — Toolchain | 3 days | Maintainability, CI, packaging | Low |
| 5 — Native Testing API | 5–8 days | Best-in-class UX; largest diff | High |
| 6 — Features | ongoing | Parity with the Go extension | Low |

**Phases 0–4 total: ~14 working days** and resolve every finding in §2.

---

## 6. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| The Go scanner mis-parses exotic Go source | Medium | 34-case tricky-Go corpus with golden outputs; the scanner reports low confidence for input it cannot lex, and discovery logs the file instead of silently listing fewer tests. A build-tagged test file is a *superset* case, not a mis-parse: the file is listed and `go test` reports no tests for it |
| `go test -json` output shape changes across Go versions | Low | The event schema has been stable since Go 1.10; pin a minimum Go version; parse defensively and fall back to the legacy path on unparseable input |
| The native Testing API migration regresses UX | Medium | Deferred to Phase 5, behind a setting, after 0–4 have shipped and stabilised |
| Modernising TypeScript surfaces many latent type errors | High | `strict` in staged steps: `strictNullChecks` first, then `strict`; the codebase is small (~1.9k lines) |

---

## 7. Out of scope

- Rewriting the extension in Go (a Go WASM/sidecar binary) — adds a build-toolchain burden for no clear win now that the scanner is in-process.
- Supporting non-Go test runners before Phase 6.
- Adding a webview UI.

---

## Appendix — how each finding was verified

- **C1** — Reproduced with Go 1.27.1: `go test -v -run '^TestAlpha|TestGamma$'` executed `TestAlphaExtra`; `-run '^(TestAlpha|TestGamma)$'` did not.
- **C4** — `go test -timeout undefined` → `invalid value "undefined" for flag -timeout`, exit 2.
- **C2a** — `src/lib/testUtil.ts:148` `return Promise.resolve();` inside the executor resolves the outer promise with `undefined`; `src/goTestExplorer.ts:96` then dereferences `result.isPassed`.
- **C6** — `go-outline` is not installed on this machine (`which go-outline` → not found); `src/lib/goOutline.ts:82` resolves `null`; `src/lib/goOutline.ts:118` iterates `(decls || [])`.
- **C11** — `src/lib/utils.ts:105` reads `vscode.window.activeTextEditor.document.uri`, whereas `src/goTestExplorer.ts:69` scopes the config to `testNode.uri`.
- **P3** — `src/fileSystemProvider.ts:196-201` awaits `this._stat(...)` inside a `for` loop, one call per directory entry.
- **`go test -json` shape** — Confirmed by running `go test -json` against a fixture with a failing subtest; the events are as quoted in §3.
