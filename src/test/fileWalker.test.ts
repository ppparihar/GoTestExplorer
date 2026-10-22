import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTestFiles } from '../discovery/fileWalker';

const SKIP = ['vendor', 'node_modules', '.git', 'testdata', 'dist'];

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-walk-'));
  tempDirs.push(dir);
  return dir;
}

function write(dir: string, relative: string, content: string = 'package x\n'): string {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

async function find(root: string, concurrency = 4): Promise<string[]> {
  const files = await findTestFiles(root, { skipFolders: SKIP, concurrency });
  return files.map((f) => path.relative(root, f)).sort();
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  tempDirs = [];
});

describe('findTestFiles', () => {
  it('finds test files in the root', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    expect(await find(root)).toEqual(['alpha_test.go']);
  });

  it('finds test files in nested directories', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    write(root, 'pkg/beta_test.go');
    write(root, 'pkg/nested/gamma_test.go');
    expect(await find(root)).toEqual([
      'alpha_test.go',
      path.join('pkg', 'beta_test.go'),
      path.join('pkg', 'nested', 'gamma_test.go'),
    ]);
  });

  it('ignores Go files that are not test files', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    write(root, 'helper.go');
    write(root, 'alpha_test.go.txt');
    expect(await find(root)).toEqual(['alpha_test.go']);
  });

  it('skips the configured folders', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    write(root, 'vendor/beta_test.go');
    write(root, 'node_modules/gamma_test.go');
    write(root, '.git/delta_test.go');
    write(root, 'testdata/epsilon_test.go');
    write(root, 'dist/zeta_test.go');
    expect(await find(root)).toEqual(['alpha_test.go']);
  });

  it('skips a skipped folder at any depth', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    write(root, 'pkg/vendor/beta_test.go');
    expect(await find(root)).toEqual(['alpha_test.go']);
  });

  it('returns nothing for a directory with no test files', async () => {
    const root = makeTempDir();
    write(root, 'helper.go');
    expect(await find(root)).toEqual([]);
  });

  it('returns nothing for a root that does not exist', async () => {
    const root = path.join(makeTempDir(), 'missing');
    expect(await find(root)).toEqual([]);
  });

  it('finds the same files whatever the concurrency', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    write(root, 'pkg/beta_test.go');
    write(root, 'pkg/nested/gamma_test.go');

    const serial = await find(root, 1);
    const parallel = await find(root, 16);
    expect(parallel).toEqual(serial);
  });

  it('finds a test file through a symlinked directory', async () => {
    const root = makeTempDir();
    const real = makeTempDir();
    write(real, 'beta_test.go');
    fs.symlinkSync(real, path.join(root, 'linked'), 'dir');
    write(root, 'alpha_test.go');

    expect(await find(root)).toEqual(['alpha_test.go', path.join('linked', 'beta_test.go')]);
  });

  it('does not loop forever on a symlink cycle', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    // A directory that contains a link back to its own parent.
    fs.symlinkSync(root, path.join(root, 'loop'), 'dir');

    const files = await find(root);
    expect(files).toContain('alpha_test.go');
    expect(files.filter((f) => f.endsWith('alpha_test.go')).length).toBe(1);
  });

  it('ignores a broken symlink', async () => {
    const root = makeTempDir();
    write(root, 'alpha_test.go');
    fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'broken_test.go'));

    expect(await find(root)).toEqual(['alpha_test.go']);
  });

  it('finds a test file that is a symlink to a file', async () => {
    const root = makeTempDir();
    const real = makeTempDir();
    write(real, 'beta_test.go');
    fs.symlinkSync(path.join(real, 'beta_test.go'), path.join(root, 'linked_test.go'));

    expect(await find(root)).toEqual(['linked_test.go']);
  });
});
