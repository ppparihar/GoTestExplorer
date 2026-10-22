import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createScope, isFileLeftOut } from '../discovery/scope';

const base = path.join(path.sep, 'work', 'proj');
const at = (...parts: string[]) => path.join(base, ...parts);

describe('createScope', () => {
  it('leaves out a path that matches a pattern, relative to the workspace folder', () => {
    const leftOut = createScope(base, ['**/generated', 'third_party/**']);
    expect(leftOut(at('a', 'generated'), true)).toBe(true);
    expect(leftOut(at('third_party', 'x', 'y_test.go'), false)).toBe(true);
    expect(leftOut(at('a', 'mine'), true)).toBe(false);
  });

  it('leaves out a directory of the module cache', () => {
    const leftOut = createScope(base, []);
    expect(leftOut(at('gopath', 'pkg', 'mod', 'github.com', 'x', 'y@v1.2.3'), true)).toBe(true);
    expect(leftOut(at('gopath', 'pkg', 'mod'), true)).toBe(false);
    expect(leftOut(at('pkg', 'mod'), true)).toBe(false);
  });

  it('does not judge a path outside the workspace folder', () => {
    const leftOut = createScope(base, ['**']);
    expect(leftOut(path.join(path.sep, 'elsewhere', 'x_test.go'), false)).toBe(false);
  });
});

describe('isFileLeftOut', () => {
  it('leaves out a file in a folder that a pattern or the module cache leaves out', () => {
    expect(isFileLeftOut(base, at('a', 'generated', 'x_test.go'), ['**/generated'])).toBe(true);
    expect(isFileLeftOut(base, at('m', 'y@v1.0.0', 'x_test.go'), [])).toBe(true);
    expect(isFileLeftOut(base, at('a', 'x_test.go'), ['**/generated'])).toBe(false);
  });

  it('leaves out a file that a pattern names', () => {
    expect(isFileLeftOut(base, at('a', 'x_test.go'), ['a/x_test.go'])).toBe(true);
  });
});
