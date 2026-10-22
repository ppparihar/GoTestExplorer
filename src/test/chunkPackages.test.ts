import { describe, it, expect } from 'vitest';
import {
  argumentBudget,
  chunkPackages,
  mergeResults,
  packageArgument,
} from '../runner/chunkPackages';
import { RawTestResult } from '../rawTestResult';
import { PackageResult } from '../exec/goTestJsonParser';

const pkg = (path: string) => ({ path });
const many = (count: number) => Array.from({ length: count }, (_, index) => pkg(`pkg/p${index}`));

describe('packageArgument', () => {
  it('names a package relative to the module root', () => {
    expect(packageArgument('pkg/a')).toBe('./pkg/a');
  });

  it('names the root package with a dot', () => {
    expect(packageArgument('')).toBe('.');
  });
});

describe('chunkPackages', () => {
  const roomy = { maxPackages: 0, maxArgChars: 1000000 };

  it('keeps the packages in one run when the limits allow', () => {
    const chunks = chunkPackages(many(50), roomy);

    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(50);
  });

  it('returns no runs for no packages', () => {
    expect(chunkPackages([], roomy)).toEqual([]);
  });

  it('splits by the number of packages', () => {
    const chunks = chunkPackages(many(5), { maxPackages: 2, maxArgChars: 1000000 });

    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
  });

  it('does not limit the number when it is zero', () => {
    expect(chunkPackages(many(500), { maxPackages: 0, maxArgChars: 1000000 }).length).toBe(1);
  });

  it('splits by the length of the arguments', () => {
    // './pkg/p0' is 8 characters and one for the space: 9 each.
    const chunks = chunkPackages(many(10), { maxPackages: 0, maxArgChars: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      const chars = chunk.reduce((sum, p) => sum + packageArgument(p.path).length + 1, 0);
      expect(chars).toBeLessThanOrEqual(30);
    });
  });

  it('keeps the order of the packages and loses none', () => {
    const packages = many(23);

    const chunks = chunkPackages(packages, { maxPackages: 0, maxArgChars: 100 });

    expect(chunks.flat()).toEqual(packages);
  });

  it('runs a package that is longer than the budget on its own', () => {
    const long = pkg('a/very/long/path/that/is/longer/than/the/budget');
    const chunks = chunkPackages([pkg('a'), long, pkg('b')], { maxPackages: 0, maxArgChars: 10 });

    expect(chunks).toEqual([[pkg('a')], [long], [pkg('b')]]);
  });

  it('never returns an empty run', () => {
    chunkPackages(many(40), { maxPackages: 3, maxArgChars: 50 }).forEach((chunk) =>
      expect(chunk.length).toBeGreaterThan(0),
    );
  });

  it('splits a module that does not fit a Windows command line', () => {
    // About 3,000 packages with a realistic path each: far past 32,000 characters.
    const packages = Array.from({ length: 3000 }, (_, index) =>
      pkg(`internal/service/pkg${index}`),
    );

    const chunks = chunkPackages(packages, {
      maxPackages: 0,
      maxArgChars: argumentBudget('win32'),
    });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      const chars = chunk.reduce((sum, p) => sum + packageArgument(p.path).length + 1, 0);
      expect(chars).toBeLessThan(32000);
    });
  });
});

describe('argumentBudget', () => {
  it('is smaller on Windows, where the command line is shorter', () => {
    expect(argumentBudget('win32')).toBeLessThan(argumentBudget('darwin'));
    expect(argumentBudget('win32')).toBeLessThan(32000);
  });
});

describe('mergeResults', () => {
  const packageResult = (name: string, failed: boolean): PackageResult => ({
    package: name,
    tests: new Map(),
    failedTests: failed ? ['TestX'] : [],
    output: [],
    failed,
    buildFailed: false,
  });

  it('passes when every run passed', () => {
    const merged = mergeResults([
      new RawTestResult(true, ['a'], []),
      new RawTestResult(true, ['b'], []),
    ]);

    expect(merged.isPassed).toBe(true);
    expect(merged.output).toEqual(['a', 'b']);
  });

  it('fails when one run failed, and keeps its failed tests', () => {
    const merged = mergeResults([
      new RawTestResult(true, [], []),
      new RawTestResult(false, [], ['TestBad']),
    ]);

    expect(merged.isPassed).toBe(false);
    expect(merged.failedTests).toEqual(['TestBad']);
  });

  it('keeps the first error', () => {
    const first = new Error('first');
    const merged = mergeResults([
      new RawTestResult(false, [], [], first),
      new RawTestResult(false, [], [], new Error('second')),
    ]);

    expect(merged.err).toBe(first);
  });

  it('joins the results of the packages of every run', () => {
    const one = new Map([['m/a', packageResult('m/a', false)]]);
    const two = new Map([['m/b', packageResult('m/b', true)]]);

    const merged = mergeResults([
      new RawTestResult(true, [], [], undefined, one),
      new RawTestResult(false, [], ['TestX'], undefined, two),
    ]);

    expect(Array.from(merged.packages.keys())).toEqual(['m/a', 'm/b']);
  });

  it('passes for no runs, because nothing failed', () => {
    expect(mergeResults([]).isPassed).toBe(true);
  });
});
