import { describe, it, expect } from 'vitest';
import { matchesFilter, visibleChildren, visibleSuites } from '../lib/testFilter';

import type { TestFilter, TestStatus } from '../lib/testFilter';

const suite = (name: string, tests: Array<string | [string, TestStatus]>) => ({
  name,
  children: tests.map((test) =>
    typeof test === 'string'
      ? { name: test, status: 'notRun' as TestStatus }
      : { name: test[0], status: test[1] },
  ),
});

const filter = (text: string, ...statuses: TestStatus[]): TestFilter => ({
  text,
  statuses: new Set(statuses),
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
    expect(visibleChildren(file, filter('beta')).map((c) => c.name)).toEqual(['TestBeta']);
  });

  it('keeps every test when the file name matches', () => {
    const file = suite('a_test.go', ['TestAlpha', 'TestBeta']);
    expect(visibleChildren(file, filter('a_test')).length).toBe(2);
  });
});

describe('the status of a test', () => {
  const file = suite('a_test.go', [
    ['TestOne', 'failed'],
    ['TestTwo', 'passed'],
    ['TestThree', 'notRun'],
  ]);

  it('keeps only the tests with a chosen status', () => {
    expect(visibleChildren(file, filter('', 'failed')).map((c) => c.name)).toEqual(['TestOne']);
    expect(visibleChildren(file, filter('', 'failed', 'notRun')).map((c) => c.name)).toEqual([
      'TestOne',
      'TestThree',
    ]);
  });

  it('applies to the tests even when the file name matches the text', () => {
    expect(visibleChildren(file, filter('a_test', 'passed')).map((c) => c.name)).toEqual([
      'TestTwo',
    ]);
  });

  it('drops a file that has no test of the status', () => {
    const files = [file, suite('b_test.go', [['TestFour', 'passed']])];
    expect(visibleSuites(files, filter('', 'failed')).map((f) => f.name)).toEqual(['a_test.go']);
  });
});

describe('visibleSuites', () => {
  it('drops the files with nothing to show', () => {
    const files = [suite('a_test.go', ['TestAlpha']), suite('b_test.go', ['TestBeta'])];
    expect(visibleSuites(files, filter('beta')).map((f) => f.name)).toEqual(['b_test.go']);
  });

  it('returns every file for an empty text', () => {
    const files = [suite('a_test.go', ['TestAlpha'])];
    expect(visibleSuites(files, filter(''))).toBe(files);
  });
});
