import { describe, it, expect } from 'vitest';
import {
  coveragePercent,
  markedLines,
  mergeCoverProfiles,
  parseCoverProfile,
} from '../lib/coverageProfile';

const PROFILE = `mode: set
example.com/mod/a.go:3.14,5.2 1 1
example.com/mod/a.go:7.2,9.3 2 0
example.com/mod/b.go:1.1,2.2 1 4
`;

describe('parseCoverProfile', () => {
  it('reads the blocks of every file and skips the mode line', () => {
    const profile = parseCoverProfile(PROFILE);
    expect(Array.from(profile.keys())).toEqual(['example.com/mod/a.go', 'example.com/mod/b.go']);
    expect(profile.get('example.com/mod/a.go')).toEqual([
      { startLine: 3, endLine: 5, statements: 1, count: 1 },
      { startLine: 7, endLine: 9, statements: 2, count: 0 },
    ]);
  });

  it('reads a Windows line ending', () => {
    expect(parseCoverProfile(PROFILE.replace(/\n/g, '\r\n')).size).toBe(2);
  });

  it('gives an empty profile for text that is not one', () => {
    expect(parseCoverProfile('').size).toBe(0);
    expect(parseCoverProfile('nonsense').size).toBe(0);
  });
});

describe('markedLines', () => {
  it('counts lines from 0 and separates covered from uncovered', () => {
    const lines = markedLines(parseCoverProfile(PROFILE).get('example.com/mod/a.go')!);
    expect(lines.covered).toEqual([2, 3, 4]);
    expect(lines.uncovered).toEqual([6, 7, 8]);
  });

  it('counts a line shared with a block that did not run as uncovered', () => {
    const lines = markedLines([
      { startLine: 1, endLine: 2, statements: 1, count: 1 },
      { startLine: 2, endLine: 3, statements: 1, count: 0 },
    ]);
    expect(lines.covered).toEqual([0]);
    expect(lines.uncovered).toEqual([1, 2]);
  });
});

describe('coveragePercent', () => {
  it('weighs a block by its statements', () => {
    const blocks = parseCoverProfile(PROFILE).get('example.com/mod/a.go')!;
    expect(coveragePercent(blocks)).toBeCloseTo(33.33, 1);
  });

  it('counts a file without statements as covered', () => {
    expect(coveragePercent([])).toBe(100);
  });
});

describe('mergeCoverProfiles', () => {
  it('takes a file from the last profile that has it', () => {
    const first = parseCoverProfile('mode: set\nx/a.go:1.1,2.1 1 0\n');
    const second = parseCoverProfile('mode: set\nx/a.go:1.1,2.1 1 1\nx/b.go:1.1,2.1 1 1\n');
    const merged = mergeCoverProfiles([first, second]);
    expect(merged.get('x/a.go')![0].count).toBe(1);
    expect(merged.size).toBe(2);
  });
});
