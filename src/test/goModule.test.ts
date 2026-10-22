import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findGoModule, importPathOf } from '../lib/goModule';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-module-'));
  tempDirs.push(dir);
  return dir;
}

function writeModule(dir: string, modulePath: string): string {
  fs.writeFileSync(path.join(dir, 'go.mod'), `module ${modulePath}\n\ngo 1.21\n`);
  return dir;
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  tempDirs = [];
});

describe('findGoModule', () => {
  it('finds the module of a directory inside it', () => {
    const root = makeTempDir();
    writeModule(root, 'example.com/mod');
    const pkg = path.join(root, 'pkg', 'a');
    fs.mkdirSync(pkg, { recursive: true });

    const module = findGoModule(pkg);

    expect(module?.root).toBe(fs.realpathSync(root) === root ? root : root);
    expect(module?.path).toBe('example.com/mod');
  });

  it('finds the module of the directory that holds the go.mod file', () => {
    const root = makeTempDir();
    writeModule(root, 'example.com/mod');

    const module = findGoModule(root);

    expect(module?.root).toBe(root);
    expect(module?.path).toBe('example.com/mod');
  });

  it('finds the nearest module when a module holds another one', () => {
    const root = makeTempDir();
    writeModule(root, 'example.com/outer');
    const inner = path.join(root, 'inner');
    fs.mkdirSync(inner, { recursive: true });
    writeModule(inner, 'example.com/inner');
    const pkg = path.join(inner, 'pkg');
    fs.mkdirSync(pkg, { recursive: true });

    const module = findGoModule(pkg);

    expect(module?.root).toBe(inner);
    expect(module?.path).toBe('example.com/inner');
  });

  it('finds no module outside one', () => {
    const dir = makeTempDir();

    expect(findGoModule(dir)).toBeUndefined();
  });

  it('reads a module path that is quoted', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'go.mod'), 'module "example.com/mod"\n');

    expect(findGoModule(root)?.path).toBe('example.com/mod');
  });

  it('ignores a comment that mentions a module', () => {
    const root = makeTempDir();
    fs.writeFileSync(
      path.join(root, 'go.mod'),
      '// module example.com/commented\nmodule example.com/mod\n',
    );

    expect(findGoModule(root)?.path).toBe('example.com/mod');
  });

  it('finds no module when the go.mod file has no module directive', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'go.mod'), 'go 1.21\n');

    expect(findGoModule(root)).toBeUndefined();
  });
});

describe('importPathOf', () => {
  it('names the root of a module after the module path', () => {
    const root = makeTempDir();
    writeModule(root, 'example.com/mod');

    const module = findGoModule(root);

    expect(importPathOf(module!, root)).toBe('example.com/mod');
  });

  it('names a package of a module after the module path and the directory', () => {
    const root = makeTempDir();
    writeModule(root, 'example.com/mod');
    const pkg = path.join(root, 'pkg', 'a');
    fs.mkdirSync(pkg, { recursive: true });

    const module = findGoModule(pkg);

    expect(importPathOf(module!, pkg)).toBe('example.com/mod/pkg/a');
  });

  it('names a package with a forward slash on every platform', () => {
    const root = makeTempDir();
    writeModule(root, 'example.com/mod');
    const pkg = path.join(root, 'pkg', 'a');
    fs.mkdirSync(pkg, { recursive: true });

    const module = findGoModule(pkg);

    expect(importPathOf(module!, pkg)).not.toContain('\\');
  });
});
