import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TestDiscovery } from '../testDiscovery';
import { TestNode } from '../testNode';
import { Commands } from '../commands';
import { __state, __reset, __setConfiguration, __fireFileWatchEvent, Uri } from './mocks/vscode';

class FakeCommands {
  discoveryStarted = 0;
  discovered: TestNode[][] = [];
  changed: TestNode[] = [];
  removed: string[] = [];

  sendTestDiscoveryStarted(): void {
    this.discoveryStarted++;
  }

  sendDiscoveredTests(nodes: TestNode[]): void {
    this.discovered.push(nodes);
  }

  sendTestFileChanged(node: TestNode): void {
    this.changed.push(node);
  }

  sendTestFileRemoved(filePath: string): void {
    this.removed.push(filePath);
  }
}

function fakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    asAbsolutePath: (relativePath: string) => relativePath,
  } as unknown as vscode.ExtensionContext;
}

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-'));
  tempDirs.push(dir);
  return dir;
}

function writeTestFile(
  dir: string,
  name: string,
  body: string = 'func TestAlpha(t *testing.T) {}',
): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `package x\n\n${body}\n`);
  return file;
}

function fakeCommands(): FakeCommands {
  return new FakeCommands();
}

beforeEach(() => {
  __reset();
});

afterEach(() => {
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  tempDirs = [];
});

describe('TestDiscovery.discoverAllTests', () => {
  it('discovers tests in every workspace folder', async () => {
    const folderA = makeTempDir();
    const folderB = makeTempDir();
    writeTestFile(folderA, 'alpha_test.go');
    writeTestFile(folderB, 'beta_test.go');

    __state.workspaceFolders = [
      { uri: Uri.file(folderA), name: 'a', index: 0 },
      { uri: Uri.file(folderB), name: 'b', index: 1 },
    ];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);

    expect(commands.discoveryStarted).toBe(1);
    const nodes = commands.discovered[0];
    const fileNames = nodes.map((n) => n.name).sort();
    expect(fileNames).toEqual(['alpha_test.go', 'beta_test.go']);
  });

  it('does not scan the same folder twice', async () => {
    const folder = makeTempDir();
    writeTestFile(folder, 'alpha_test.go');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);
    expect(commands.discovered[0].length).toBe(1);
  });

  it('sends an empty result when there are no workspace folders', () => {
    __state.workspaceFolders = [];
    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    expect(commands.discovered.length).toBe(1);
    expect(commands.discovered[0]).toEqual([]);
  });

  it('ignores folders that are not on the file system', async () => {
    const folder = makeTempDir();
    writeTestFile(folder, 'alpha_test.go');
    __state.workspaceFolders = [
      { uri: Uri.parse('untitled:workspace-1'), name: 'virtual', index: 0 },
      { uri: Uri.file(folder), name: 'a', index: 1 },
    ];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);
    expect(commands.discovered[0].map((n) => n.name)).toEqual(['alpha_test.go']);
  });

  it('discovers the test names in a file', async () => {
    const folder = makeTempDir();
    writeTestFile(
      folder,
      'alpha_test.go',
      ['func TestAlpha(t *testing.T) {}', 'func TestBeta(t *testing.T) {}'].join('\n'),
    );
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);

    const suite = commands.discovered[0][0];
    expect(suite.name).toBe('alpha_test.go');
    expect(suite.children.map((c) => c.name)).toEqual(['TestAlpha', 'TestBeta']);
  });

  it('discovers tests without any external tool installed', async () => {
    const folder = makeTempDir();
    writeTestFile(folder, 'alpha_test.go');
    writeTestFile(folder, 'beta_test.go');
    writeTestFile(folder, 'gamma_test.go');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);

    // Discovery is entirely in-process, so it neither needs a Go
    // toolchain nor complains about a missing one.
    expect(__state.messages.error).toEqual([]);
    expect(commands.discovered[0].length).toBe(3);
  });

  it('ignores files that are not Go test files', async () => {
    const folder = makeTempDir();
    writeTestFile(folder, 'alpha_test.go');
    writeTestFile(folder, 'helper.go');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);
    expect(commands.discovered[0].map((n) => n.name)).toEqual(['alpha_test.go']);
  });

  it('reports a file it could not scan with confidence', async () => {
    const folder = makeTempDir();
    // An unterminated string is not valid Go, so the file cannot be
    // scanned with confidence and may hold tests the scan missed.
    writeTestFile(folder, 'broken_test.go', 'const s = "unterminated');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const commands = fakeCommands();
      new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

      await waitFor(() => commands.discovered.length > 0);

      expect(commands.discovered[0].map((n) => n.name)).toEqual(['broken_test.go']);
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toContain('broken_test.go');
      expect(warn.mock.calls[0][0]).toContain('unterminated string literal');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('TestDiscovery workspace path resolution', () => {
  it('resolves the workspace folder through fsPath, not path', async () => {
    const folder = makeTempDir();
    writeTestFile(folder, 'alpha_test.go');

    // Simulates Windows, where `uri.path` is `/c:/repo` but `uri.fsPath`
    // is the real path on disk. Using `path` finds nothing there.
    const uri = Uri.__fileWithDifferentFsPath('/c:/repo', folder);
    __state.workspaceFolders = [{ uri, name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);

    const nodes = commands.discovered[0];
    expect(nodes.length).toBe(1);
    expect(nodes[0].uri.fsPath).toBe(path.join(folder, 'alpha_test.go'));
  });

  it('scans the src directory of a folder when it exists', async () => {
    const folder = makeTempDir();
    const src = path.join(folder, 'src');
    fs.mkdirSync(src);
    writeTestFile(src, 'alpha_test.go');
    writeTestFile(folder, 'root_test.go');

    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    await waitFor(() => commands.discovered.length > 0);
    expect(commands.discovered[0].map((n) => n.name)).toEqual(['alpha_test.go']);
  });
});

it('does not walk a folder the user asked to skip', async () => {
  const folder = makeTempDir();
  writeTestFile(folder, 'alpha_test.go');
  const fixtures = path.join(folder, 'fixtures');
  fs.mkdirSync(fixtures);
  writeTestFile(fixtures, 'fixture_test.go');
  __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];
  __setConfiguration('goTestExplorer', { skipFolders: ['fixtures'] });

  const commands = fakeCommands();
  new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
  await waitFor(() => commands.discovered.length > 0);

  expect(commands.discovered[0].map((n) => n.name)).toEqual(['alpha_test.go']);
});

describe('TestDiscovery file watching', () => {
  it('watches the workspace for Go test files', () => {
    __state.workspaceFolders = [];
    new TestDiscovery(fakeCommands() as unknown as Commands, fakeContext());

    expect(__state.fileWatchers.length).toBe(1);
    expect(__state.fileWatchers[0].glob).toBe('**/*_test.go');
  });

  it('reports the tests in a file that changed', async () => {
    const folder = makeTempDir();
    const file = writeTestFile(folder, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    writeTestFile(folder, 'alpha_test.go', 'func TestBeta(t *testing.T) {}');
    __fireFileWatchEvent('change', file);

    await waitFor(() => commands.changed.length > 0);
    expect(commands.changed[0].name).toBe('alpha_test.go');
    expect(commands.changed[0].children.map((c) => c.name)).toEqual(['TestBeta']);
  });

  it('reports a file that was created', async () => {
    const folder = makeTempDir();
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    const file = writeTestFile(folder, 'gamma_test.go', 'func TestGamma(t *testing.T) {}');
    __fireFileWatchEvent('create', file);

    await waitFor(() => commands.changed.length > 0);
    expect(commands.changed[0].children.map((c) => c.name)).toEqual(['TestGamma']);
  });

  it('removes a file that was deleted', async () => {
    const folder = makeTempDir();
    const file = writeTestFile(folder, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    __fireFileWatchEvent('delete', file);

    await waitFor(() => commands.removed.length > 0);
    expect(commands.removed[0]).toBe(file);
  });

  it('ignores a file outside the directory that is scanned', async () => {
    const folder = makeTempDir();
    const src = path.join(folder, 'src');
    fs.mkdirSync(src);
    const file = writeTestFile(folder, 'outside_test.go', 'func TestOutside(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    __fireFileWatchEvent('change', file);
    await delay(50);

    // The tree only holds the tests under `src`, so a file elsewhere in
    // the workspace is not part of it.
    expect(commands.changed.length).toBe(0);
  });

  it('ignores a file in a skipped folder', async () => {
    const folder = makeTempDir();
    const vendor = path.join(folder, 'vendor');
    fs.mkdirSync(vendor);
    const file = writeTestFile(vendor, 'vendored_test.go', 'func TestVendored(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    __fireFileWatchEvent('change', file);
    await delay(50);

    expect(commands.changed.length).toBe(0);
  });

  it('discards a change that a newer one has overtaken', async () => {
    const folder = makeTempDir();
    const file = writeTestFile(folder, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    // The first read is held back, so the second change overtakes it.
    // The held-back read still sees the old contents, which is what
    // makes the overtaken result worth discarding.
    const realReadFile = fs.promises.readFile;
    let firstRead = true;
    const spy = vi
      .spyOn(fs.promises, 'readFile')
      .mockImplementation(async (target: any, options: any) => {
        const content = await realReadFile(target, options);
        if (firstRead) {
          firstRead = false;
          await delay(50);
        }
        return content;
      });

    try {
      __fireFileWatchEvent('change', file);
      await delay(10);

      writeTestFile(folder, 'alpha_test.go', 'func TestBravo(t *testing.T) {}');
      __fireFileWatchEvent('change', file);

      await waitFor(() => commands.changed.length > 0);
      await delay(100);

      // Only the newer change is applied, and it carries the newer
      // contents.
      expect(commands.changed.length).toBe(1);
      expect(commands.changed[0].children.map((c) => c.name)).toEqual(['TestBravo']);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not let a superseded scan put the pre-edit contents back in the cache', async () => {
    const folder = makeTempDir();
    const file = writeTestFile(folder, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    const discovery = new TestDiscovery(commands as unknown as Commands, fakeContext());
    discovery.discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    // A file system with a coarse modification time: the metadata of the
    // file never changes, so only the watcher's invalidation keeps the
    // cache honest.
    const realStat = fs.promises.stat;
    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (target: any) => {
      const stats = await realStat(target);
      if (target === file) {
        return { ...stats, mtimeMs: 1000 } as any;
      }
      return stats;
    });

    // The first read is held back, so the second change overtakes it.
    // The held-back read still sees the old contents, which is what
    // makes the overtaken result worth discarding.
    const realReadFile = fs.promises.readFile;
    let firstRead = true;
    const readSpy = vi
      .spyOn(fs.promises, 'readFile')
      .mockImplementation(async (target: any, options: any) => {
        const content = await realReadFile(target, options);
        if (firstRead) {
          firstRead = false;
          await delay(50);
        }
        return content;
      });

    try {
      __fireFileWatchEvent('change', file);
      await delay(10);

      // The same length as before, so the size does not change either.
      writeTestFile(folder, 'alpha_test.go', 'func TestBravo(t *testing.T) {}');
      __fireFileWatchEvent('change', file);

      await waitFor(() => commands.changed.length > 0);
      await delay(100);

      // A refresh reads the file again rather than trusting the cache.
      discovery.discoverAllTests();
      await waitFor(() => commands.discovered.length > 1);

      const suite = commands.discovered[1][0];
      expect(suite.children.map((c) => c.name)).toEqual(['TestBravo']);
    } finally {
      readSpy.mockRestore();
      statSpy.mockRestore();
    }
  });

  it('applies a change that arrived while the discovery was running', async () => {
    const folder = makeTempDir();
    const file = writeTestFile(folder, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();

    // The file is written while the first discovery is still running, so
    // the change cannot be applied until that discovery has finished.
    writeTestFile(folder, 'alpha_test.go', 'func TestBeta(t *testing.T) {}');
    __fireFileWatchEvent('change', file);

    await waitFor(() => commands.changed.length > 0);
    expect(commands.changed[0].children.map((c) => c.name)).toEqual(['TestBeta']);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('TestDiscovery chooses what to load', () => {
  function workspaceWithPackages() {
    const folder = makeTempDir();
    for (const name of ['api', 'worker', 'tools/gen']) {
      const dir = path.join(folder, name);
      fs.mkdirSync(dir, { recursive: true });
      writeTestFile(dir, `${path.basename(name)}_test.go`);
    }
    __state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];
    return folder;
  }

  async function discover(): Promise<string[]> {
    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);
    return commands.discovered[0].map((n) => n.name).sort();
  }

  it('loads only the folders that were listed', async () => {
    workspaceWithPackages();
    __setConfiguration('goTestExplorer', { includePaths: ['api', 'tools'] });

    expect(await discover()).toEqual(['api_test.go', 'gen_test.go']);
  });

  it('loads everything when the list is empty', async () => {
    workspaceWithPackages();
    __setConfiguration('goTestExplorer', { includePaths: [] });

    expect(await discover()).toEqual(['api_test.go', 'gen_test.go', 'worker_test.go']);
  });

  it('does not list a folder that is inside another listed folder twice', async () => {
    workspaceWithPackages();
    __setConfiguration('goTestExplorer', { includePaths: ['tools', 'tools/gen'] });

    expect(await discover()).toEqual(['gen_test.go']);
  });

  it('says which listed folders do not exist, and loads the ones that do', async () => {
    workspaceWithPackages();
    __setConfiguration('goTestExplorer', { includePaths: ['api', 'nope'] });

    expect(await discover()).toEqual(['api_test.go']);
    expect(__state.messages.warning.join('\n')).toContain('nope');
  });

  it('leaves out the paths that match an exclude pattern', async () => {
    workspaceWithPackages();
    __setConfiguration('goTestExplorer', { excludePaths: ['tools/**', 'worker'] });

    expect(await discover()).toEqual(['api_test.go']);
  });

  it('leaves out what files.exclude hides, unless the user turned that off', async () => {
    workspaceWithPackages();
    __setConfiguration('files', { exclude: { '**/worker': true, '**/api': false } });

    expect(await discover()).toEqual(['api_test.go', 'gen_test.go']);

    __setConfiguration('goTestExplorer', { useFilesExclude: false });
    expect(await discover()).toEqual(['api_test.go', 'gen_test.go', 'worker_test.go']);
  });

  it('does not walk the module cache of a GOPATH inside the project', async () => {
    const folder = workspaceWithPackages();
    const cached = path.join(folder, 'gopath', 'pkg', 'mod', 'github.com', 'x', 'y@v1.2.3');
    fs.mkdirSync(cached, { recursive: true });
    writeTestFile(cached, 'cached_test.go');

    expect(await discover()).toEqual(['api_test.go', 'gen_test.go', 'worker_test.go']);
  });

  it('ignores a changed file that a pattern leaves out', async () => {
    const folder = workspaceWithPackages();
    __setConfiguration('goTestExplorer', { excludePaths: ['worker'] });
    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    __fireFileWatchEvent('change', path.join(folder, 'worker', 'worker_test.go'));
    await delay(50);
    expect(commands.changed.length).toBe(0);

    __fireFileWatchEvent('change', path.join(folder, 'api', 'api_test.go'));
    await waitFor(() => commands.changed.length > 0);
    expect(commands.changed[0].name).toBe('api_test.go');
  });

  it('discovers again when a setting that chooses the paths changes', async () => {
    workspaceWithPackages();
    const commands = fakeCommands();
    new TestDiscovery(commands as unknown as Commands, fakeContext()).discoverAllTests();
    await waitFor(() => commands.discovered.length > 0);

    __setConfiguration('goTestExplorer', { includePaths: ['api'] });
    __state.configListeners.forEach((listener) =>
      listener({ affectsConfiguration: (section) => section === 'goTestExplorer.includePaths' }),
    );
    await waitFor(() => commands.discovered.length > 1);

    expect(commands.discovered[1].map((n) => n.name)).toEqual(['api_test.go']);
  });
});
