import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { TestNode } from './testNode';
import { Commands } from './commands';
import { discoverTests, DiscoveredSuite } from './discovery/discover';
import { isInSkippedFolder } from './discovery/fileWalker';
import { ScanCache } from './discovery/scanCache';
import { GoTestDecl } from './discovery/goScanner';
import { skipFolders } from './lib/settings';

export class TestDiscovery {
  private readonly cache = new ScanCache();

  /**
   * The workspace folders that are on the file system. A changed file
   * outside them is not ours to react to.
   */
  private workspaceFolders: string[] = [];

  /**
   * The directories that are actually scanned. A folder with a `src`
   * directory is scanned from there, so a test file elsewhere in the
   * workspace is not part of the tree.
   */
  private roots: string[] = [];

  /**
   * The files that changed while a discovery was running. They are applied
   * once that discovery has finished, so an edit made during the first
   * scan is not lost.
   */
  private readonly pendingChanges = new Set<string>();

  /**
   * The number of changes seen for a file. A scan that has been overtaken
   * by a newer one is discarded rather than reported.
   */
  private readonly changeVersions = new Map<string, number>();

  /**
   * False until the first discovery has finished.
   */
  private discovered = false;

  constructor(
    private commands: Commands,
    private context: vscode.ExtensionContext,
  ) {
    this.watchForTestFiles();
  }

  discoverAllTests() {
    this.commands.sendTestDiscoveryStarted();

    const workspaceFolders = (vscode.workspace.workspaceFolders || []).filter(
      (folder) => folder.uri.scheme === 'file',
    );

    this.workspaceFolders = workspaceFolders.map((folder) => folder.uri.fsPath);
    this.roots = [];
    this.discovered = false;

    if (workspaceFolders.length === 0) {
      this.commands.sendDiscoveredTests([]);
      this.discovered = true;
      this.applyPendingChanges();
      return;
    }

    Promise.all(workspaceFolders.map((folder) => this.discoverFolderTests(folder.uri)))
      .then((results) => {
        this.commands.sendDiscoveredTests([].concat(...results));
        this.discovered = true;
        this.applyPendingChanges();
      })
      .catch((err) => {
        vscode.window.showErrorMessage('An error occurred: ' + err);
        this.commands.sendDiscoveredTests([]);
        this.discovered = true;
        this.applyPendingChanges();
      });
  }

  /**
   * Discovers the tests under a single workspace folder. A folder with a
   * `src` directory is scanned from there, otherwise from the folder root.
   */
  private async discoverFolderTests(folderUri: vscode.Uri): Promise<TestNode[]> {
    const srcLocation = path.join(folderUri.fsPath, 'src');
    const root = (await directoryExists(srcLocation)) ? srcLocation : folderUri.fsPath;
    this.roots.push(root);
    return this.discoverTests(vscode.Uri.file(root));
  }

  async discoverTests(uri: vscode.Uri): Promise<TestNode[]> {
    const suites = await discoverTests(uri.fsPath, { cache: this.cache });
    return suites.map((suite) => {
      this.warnIfUnconfident(suite);
      return this.buildSuiteNode(suite.file, suite.declarations);
    });
  }

  /**
   * Builds the tree node for one test file.
   *
   * A file with no test functions still gets a node, so that the tree
   * shows that the file was seen and found to hold nothing runnable.
   */
  private buildSuiteNode(file: string, declarations: readonly GoTestDecl[]): TestNode {
    const uri = vscode.Uri.file(file);
    const sorted = declarations.slice().sort((a, b) => a.name.localeCompare(b.name));
    const children = sorted.map((declaration) => new TestNode(declaration.name, uri));
    return new TestNode(path.basename(file), uri, children);
  }

  /**
   * Reports a file that could not be scanned with confidence.
   *
   * Such a file is broken Go, so it is reported rather than quietly listed
   * with fewer tests than it declares.
   */
  private warnIfUnconfident(suite: DiscoveredSuite) {
    if (!suite.confident) {
      console.warn(
        `go-test-explorer: ${suite.file} could not be scanned (${suite.reason}); the tests it declares may be missing.`,
      );
    }
  }

  /**
   * Watches the workspace for test files, so that a change is reflected in
   * the tree without a manual refresh.
   */
  private watchForTestFiles() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*_test.go');
    watcher.onDidCreate((uri) => this.onTestFileChanged(uri));
    watcher.onDidChange((uri) => this.onTestFileChanged(uri));
    watcher.onDidDelete((uri) => this.onTestFileRemoved(uri));
    this.context.subscriptions.push(watcher);
  }

  /**
   * A test file was created or changed. Only that file is scanned, so the
   * tree is updated without a walk of the whole workspace.
   */
  private async onTestFileChanged(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    if (!this.isInWorkspace(filePath)) {
      return;
    }

    if (!this.discovered) {
      // A discovery is running. It may or may not have read this file
      // yet, so the change is applied once it has finished.
      this.pendingChanges.add(filePath);
      return;
    }

    if (!this.isInScope(filePath)) {
      return;
    }

    const version = this.nextVersion(filePath);
    this.cache.invalidate(filePath);

    try {
      const scan = await this.cache.scan(filePath);
      if (this.changeVersions.get(filePath) !== version) {
        // A newer change to the same file has overtaken this one, so
        // this result is dropped. The cached entry may hold the
        // contents of the file before that newer change, so it is
        // dropped too and the next read picks up what is on disk.
        this.cache.invalidate(filePath);
        return;
      }
      this.warnIfUnconfident({
        file: filePath,
        declarations: scan.declarations,
        confident: scan.confident,
        reason: scan.reason,
      });
      this.commands.sendTestFileChanged(this.buildSuiteNode(filePath, scan.declarations));
    } catch (e) {
      // The file was deleted between the event and the read.
      this.commands.sendTestFileRemoved(filePath);
    }
  }

  /**
   * A test file was deleted, so it leaves the tree.
   */
  private onTestFileRemoved(uri: vscode.Uri) {
    const filePath = uri.fsPath;

    if (!this.isInWorkspace(filePath)) {
      return;
    }

    this.cache.invalidate(filePath);

    if (!this.discovered) {
      this.pendingChanges.add(filePath);
      return;
    }

    if (!this.isInScope(filePath)) {
      return;
    }

    this.commands.sendTestFileRemoved(filePath);
  }

  /**
   * Applies the changes that arrived while a discovery was running.
   */
  private applyPendingChanges() {
    const pending = Array.from(this.pendingChanges);
    this.pendingChanges.clear();
    pending.forEach((filePath) => this.onTestFileChanged(vscode.Uri.file(filePath)));
  }

  /**
   * Whether a file is inside the workspace at all.
   */
  private isInWorkspace(filePath: string): boolean {
    return this.workspaceFolders.some((folder) => isUnder(folder, filePath));
  }

  /**
   * Whether a file is part of the tree: inside a directory that is
   * scanned, and not inside a directory that is skipped.
   */
  private isInScope(filePath: string): boolean {
    if (isInSkippedFolder(filePath, skipFolders())) {
      return false;
    }
    return this.roots.some((root) => isUnder(root, filePath));
  }

  /**
   * Numbers a change to a file, so that a scan that has been overtaken by
   * a newer one can be recognised and discarded.
   */
  private nextVersion(filePath: string): number {
    const version = (this.changeVersions.get(filePath) || 0) + 1;
    this.changeVersions.set(filePath, version);
    return version;
  }
}

/**
 * Whether a path is a directory or a file inside it.
 */
function isUnder(root: string, filePath: string): boolean {
  if (filePath === root) {
    return true;
  }
  const relative = path.relative(root, filePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function directoryExists(target: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    fs.stat(target, (err, stat) => resolve(!err && stat.isDirectory()));
  });
}
