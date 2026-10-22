import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScanCache } from '../discovery/scanCache';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-cache-'));
  tempDirs.push(dir);
  return dir;
}

function writeTestFile(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `package x\n\n${body}\n`);
  return file;
}

/**
 * Counts how often a file is read, so that a test can tell a cached scan
 * from a fresh one.
 */
function countReads(): { count: () => number; restore: () => void } {
  const spy = vi.spyOn(fs.promises, 'readFile');
  return {
    count: () => spy.mock.calls.length,
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  tempDirs = [];
});

describe('ScanCache', () => {
  it('finds the tests in a file', async () => {
    const dir = makeTempDir();
    const file = writeTestFile(dir, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');

    const cache = new ScanCache();
    const scan = await cache.scan(file);

    expect(scan.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
    expect(scan.confident).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('does not read an unchanged file again', async () => {
    const dir = makeTempDir();
    const file = writeTestFile(dir, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');

    const cache = new ScanCache();
    await cache.scan(file);

    const reads = countReads();
    const scan = await cache.scan(file);
    const readCount = reads.count();
    reads.restore();

    expect(readCount).toBe(0);
    expect(scan.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('reads a file again after it has changed', async () => {
    const dir = makeTempDir();
    const file = writeTestFile(dir, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');

    const cache = new ScanCache();
    await cache.scan(file);

    writeTestFile(dir, 'alpha_test.go', 'func TestBeta(t *testing.T) {}');
    const scan = await cache.scan(file);

    expect(scan.declarations.map((d) => d.name)).toEqual(['TestBeta']);
  });

  it('reads a file again when only its contents changed', async () => {
    const dir = makeTempDir();
    // The same length as the original, so only the modification time
    // tells the two apart.
    const file = writeTestFile(dir, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');

    const cache = new ScanCache();
    await cache.scan(file);

    writeTestFile(dir, 'alpha_test.go', 'func TestBravo(t *testing.T) {}');
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(file, later, later);
    const scan = await cache.scan(file);

    expect(scan.declarations.map((d) => d.name)).toEqual(['TestBravo']);
  });

  it('reads a file again once it has been invalidated', async () => {
    const dir = makeTempDir();
    const file = writeTestFile(dir, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');

    const cache = new ScanCache();
    await cache.scan(file);

    const reads = countReads();
    await cache.scan(file);
    const cachedReadCount = reads.count();

    cache.invalidate(file);
    await cache.scan(file);
    const invalidatedReadCount = reads.count();
    reads.restore();

    expect(cachedReadCount).toBe(0);
    expect(invalidatedReadCount).toBe(1);
  });

  it('forgets every file when it is cleared', async () => {
    const dir = makeTempDir();
    const file = writeTestFile(dir, 'alpha_test.go', 'func TestAlpha(t *testing.T) {}');

    const cache = new ScanCache();
    await cache.scan(file);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('fails when the file does not exist', async () => {
    const dir = makeTempDir();
    const cache = new ScanCache();

    await expect(cache.scan(path.join(dir, 'missing_test.go'))).rejects.toThrow();
  });
});
