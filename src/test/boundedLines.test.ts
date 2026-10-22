import { describe, it, expect } from 'vitest';
import { BoundedLines } from '../exec/boundedLines';
import { GoTestJsonParser } from '../exec/goTestJsonParser';

describe('BoundedLines', () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`);

  it('keeps every line while it is under the limit', () => {
    const bounded = new BoundedLines(10);
    bounded.addAll(lines(10));

    expect(bounded.toArray()).toEqual(lines(10));
    expect(bounded.omitted).toBe(0);
  });

  it('keeps the first and the last lines of an output that is over the limit', () => {
    const bounded = new BoundedLines(10);
    bounded.addAll(lines(100));

    const kept = bounded.toArray();

    expect(kept[0]).toBe('line 0');
    expect(kept[kept.length - 1]).toBe('line 99');
  });

  it('says how many lines were dropped, where they were', () => {
    const bounded = new BoundedLines(10);
    bounded.addAll(lines(100));

    const kept = bounded.toArray();

    expect(bounded.omitted).toBe(90);
    expect(kept).toContain('... 90 lines omitted ...');
    // 1 for the head, 9 for the tail, and the marker.
    expect(kept.length).toBe(11);
  });

  it('keeps the lines in order', () => {
    const bounded = new BoundedLines(10);
    bounded.addAll(lines(37));

    const numbers = bounded
      .toArray()
      .filter((line) => line.startsWith('line '))
      .map((line) => Number(line.slice(5)));

    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('keeps at least one line from each end for a tiny limit', () => {
    const bounded = new BoundedLines(1);
    bounded.addAll(lines(5));

    const kept = bounded.toArray();

    expect(kept[0]).toBe('line 0');
    expect(kept[kept.length - 1]).toBe('line 4');
  });

  it('holds a bounded number of lines however many are added', () => {
    const bounded = new BoundedLines(100);
    bounded.addAll(lines(200000));

    expect(bounded.toArray().length).toBeLessThanOrEqual(101);
  });
});

describe('GoTestJsonParser with a test that prints without end', () => {
  const event = (action: string, extra: object = {}) =>
    JSON.stringify({ Action: action, Package: 'p', Test: 'TestNoisy', ...extra }) + '\n';

  it('keeps the output of the test bounded, and its end', () => {
    const parser = new GoTestJsonParser();
    parser.write(event('run'));
    const total = 50000;
    for (let index = 0; index < total; index++) {
      parser.write(event('output', { Output: `log ${index}\n` }));
    }
    parser.write(event('output', { Output: 'panic: the end\n' }));
    parser.write(event('fail', { Elapsed: 1 }));

    const outcome = parser.results.packages.get('p')?.tests.get('TestNoisy');

    expect(outcome?.output.length).toBeLessThan(1100);
    expect(outcome?.output[0]).toBe('log 0');
    expect(outcome?.output[outcome.output.length - 1]).toBe('panic: the end');
    expect(outcome?.output.some((line) => /lines omitted/.test(line))).toBe(true);
  });

  it('still reports the outcome of the test', () => {
    const parser = new GoTestJsonParser();
    parser.write(event('run'));
    for (let index = 0; index < 5000; index++) {
      parser.write(event('output', { Output: `log ${index}\n` }));
    }
    parser.write(event('fail', { Elapsed: 1 }));

    expect(parser.results.packages.get('p')?.failedTests).toEqual(['TestNoisy']);
  });

  it('still gives the terminal every line as it arrives', () => {
    const parser = new GoTestJsonParser();
    let seen = 0;
    for (let index = 0; index < 5000; index++) {
      seen += parser.write(event('output', { Output: `log ${index}\n` })).output.length;
    }

    expect(seen).toBe(5000);
  });
});
