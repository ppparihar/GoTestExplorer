import { describe, it, expect } from 'vitest';
import { matchesFilter, visibleChildren, visibleSuites } from '../lib/testFilter';

const suite = (name: string, tests: string[]) => ({
  name,
  children: tests.map((test) => ({ name: test })),
});

describe('matchesFilter', () => {
  it('matches everything when the text is empty', () => {
    expect(matchesFilter('TestAlpha', '')).toBe(true);
    expect(matchesFilter('TestAlpha', '   ')).toBe(true);
  });

  it('ignores case', () => {
    expect(matchesFilter('TestAlpha', 'alpha')).toBe(true);
  });

  it('needs every word, in any order', () => {
    expect(matchesFilter('TestAlphaBeta', 'beta alpha')).toBe(true);
    expect(matchesFilter('TestAlpha', 'alpha beta')).toBe(false);
  });
});

describe('visibleChildren', () => {
  it('keeps only the tests that match', () => {
    const file = suite('a_test.go', ['TestAlpha', 'TestBeta']);
    expect(visibleChildren(file, 'beta').map((c) => c.name)).toEqual(['TestBeta']);
  });

  it('keeps every test when the file name matches', () => {
    const file = suite('a_test.go', ['TestAlpha', 'TestBeta']);
    expect(visibleChildren(file, 'a_test').length).toBe(2);
  });
});

describe('visibleSuites', () => {
  it('drops the files with nothing to show', () => {
    const files = [suite('a_test.go', ['TestAlpha']), suite('b_test.go', ['TestBeta'])];
    expect(visibleSuites(files, 'beta').map((f) => f.name)).toEqual(['b_test.go']);
  });

  it('returns every file for an empty text', () => {
    const files = [suite('a_test.go', ['TestAlpha'])];
    expect(visibleSuites(files, '')).toBe(files);
  });
});
