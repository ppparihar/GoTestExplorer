import { describe, it, expect } from 'vitest';
import {
  buildRunRegex,
  buildTargetArgs,
  resolveTestTimeout,
  DEFAULT_TEST_TIMEOUT,
} from '../lib/testArgs';

describe('buildRunRegex', () => {
  it('groups the alternation so the anchors bind to the whole expression', () => {
    expect(buildRunRegex(['TestAlpha', 'TestBeta'])).toBe('^(TestAlpha|TestBeta)$');
  });

  it('wraps a single function in a group too', () => {
    expect(buildRunRegex(['TestAlpha'])).toBe('^(TestAlpha)$');
  });

  it('produces a regex that does not match a longer sibling name', () => {
    // The bug this guards: `^TestAlpha|TestBeta$` parses as
    // `(^TestAlpha)|(TestBeta$)`, so `TestAlphaExtra` also matches.
    const regex = new RegExp(buildRunRegex(['TestAlpha', 'TestBeta']));
    expect(regex.test('TestAlpha')).toBe(true);
    expect(regex.test('TestBeta')).toBe(true);
    expect(regex.test('TestAlphaExtra')).toBe(false);
    expect(regex.test('XTestBeta')).toBe(false);
  });
});

describe('buildTargetArgs', () => {
  it('emits -run with a correctly anchored regex for a test selection', () => {
    expect(buildTargetArgs({ functions: ['TestA', 'TestB'] })).toEqual(['-run', '^(TestA|TestB)$']);
  });

  it('emits -run for a single test', () => {
    expect(buildTargetArgs({ functions: ['TestA'] })).toEqual(['-run', '^(TestA)$']);
  });

  it('emits no target arguments for an empty function list', () => {
    expect(buildTargetArgs({ functions: [] })).toEqual([]);
  });

  it('emits -bench with an anchored regex for benchmarks', () => {
    expect(buildTargetArgs({ functions: ['BenchA', 'BenchB'], isBenchmark: true })).toEqual([
      '-bench',
      '^(BenchA|BenchB)$',
    ]);
  });

  it('emits -bench . when no functions are specified for a benchmark', () => {
    expect(buildTargetArgs({ isBenchmark: true })).toEqual(['-bench', '.']);
  });

  it('emits nothing when there is neither a selection nor a benchmark', () => {
    expect(buildTargetArgs({})).toEqual([]);
  });
});

describe('resolveTestTimeout', () => {
  it('returns the configured value when it is a usable string', () => {
    expect(resolveTestTimeout('90s')).toBe('90s');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveTestTimeout('  90s  ')).toBe('90s');
  });

  it('falls back to the default when the setting is missing', () => {
    expect(resolveTestTimeout(undefined)).toBe(DEFAULT_TEST_TIMEOUT);
  });

  it('falls back to the default when the setting is an empty string', () => {
    expect(resolveTestTimeout('')).toBe(DEFAULT_TEST_TIMEOUT);
  });

  it('falls back to the default when the setting is a non-string', () => {
    expect(resolveTestTimeout(30)).toBe(DEFAULT_TEST_TIMEOUT);
  });

  it('never returns the string "undefined", which go test rejects', () => {
    // `go test -timeout undefined` fails with
    // `invalid value "undefined" for flag -timeout`.
    expect(resolveTestTimeout(undefined)).not.toBe('undefined');
    expect(resolveTestTimeout(null)).not.toBe('undefined');
  });
});
