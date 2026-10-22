import { describe, it, expect } from 'vitest';
import { createMatcher, globToRegExp } from '../discovery/glob';

const matches = (pattern: string, path: string) => globToRegExp(pattern).test(path);

describe('globToRegExp', () => {
  it('matches a name exactly, from the root', () => {
    expect(matches('vendor', 'vendor')).toBe(true);
    expect(matches('vendor', 'a/vendor')).toBe(false);
    expect(matches('vendor', 'vendors')).toBe(false);
  });

  it('matches at any depth with **/', () => {
    expect(matches('**/node_modules', 'node_modules')).toBe(true);
    expect(matches('**/node_modules', 'a/b/node_modules')).toBe(true);
    expect(matches('**/node_modules', 'a/node_modules_x')).toBe(false);
  });

  it('keeps * inside one folder', () => {
    expect(matches('a/*_test.go', 'a/x_test.go')).toBe(true);
    expect(matches('a/*_test.go', 'a/b/x_test.go')).toBe(false);
    expect(matches('a/?.go', 'a/x.go')).toBe(true);
    expect(matches('a/?.go', 'a/xy.go')).toBe(false);
  });

  it('lets ** at the end match everything below', () => {
    expect(matches('gen/**', 'gen/a/b.go')).toBe(true);
    expect(matches('gen/**', 'other/a.go')).toBe(false);
  });

  it('reads braces and sets', () => {
    expect(matches('**/{vendor,third_party}', 'a/third_party')).toBe(true);
    expect(matches('**/{vendor,third_party}', 'a/other')).toBe(false);
    expect(matches('a/[xy].go', 'a/y.go')).toBe(true);
    expect(matches('a/[!xy].go', 'a/z.go')).toBe(true);
    expect(matches('a/[!xy].go', 'a/x.go')).toBe(false);
  });

  it('takes a dot and the like as themselves', () => {
    expect(matches('**/.git', 'x/.git')).toBe(true);
    expect(matches('a.b', 'aXb')).toBe(false);
  });
});

describe('createMatcher', () => {
  it('matches a path inside a folder that is left out', () => {
    const matcher = createMatcher(['**/vendor']);
    expect(matcher('vendor')).toBe(true);
    expect(matcher('a/vendor/x/y_test.go')).toBe(true);
    expect(matcher('a/mine/y_test.go')).toBe(false);
  });

  it('matches nothing without a pattern', () => {
    expect(createMatcher([])('anything')).toBe(false);
    expect(createMatcher(['  '])('anything')).toBe(false);
  });
});
