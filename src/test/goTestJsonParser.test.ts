import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  GoTestJsonParser,
  GoTestResults,
  FinishedTest,
  PackageResult,
  hasFailed,
} from '../exec/goTestJsonParser';

/**
 * The output of a real `go test -json` run, captured from the toolchain.
 */
function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

/**
 * Reads a whole stream through the parser.
 */
function parse(text: string) {
  const parser = new GoTestJsonParser();
  const output: string[] = [];
  const buildOutput: string[] = [];
  const chunk = parser.write(text);
  output.push(...chunk.output);
  buildOutput.push(...chunk.buildOutput);
  const last = parser.end();
  output.push(...last.output);
  buildOutput.push(...last.buildOutput);
  return { results: parser.results, output, buildOutput };
}

/**
 * The result of one package of a run.
 */
function packageOf(results: GoTestResults, name: string): PackageResult {
  const pkg = results.packages.get(name);
  expect(pkg).toBeDefined();
  return pkg as PackageResult;
}

/**
 * The result of the only package of a run.
 */
function onlyPackage(results: GoTestResults): PackageResult {
  const packages = Array.from(results.packages.values());
  expect(packages.length).toBe(1);
  return packages[0];
}

describe('GoTestJsonParser', () => {
  it('reads the outcome of every test from a real run', () => {
    const { results } = parse(fixture('goTestJsonMixed.jsonl'));
    const pkg = onlyPackage(results);

    expect(pkg.tests.get('TestAlpha')?.action).toBe('fail');
    expect(pkg.tests.get('TestAlpha/sub1')?.action).toBe('fail');
    expect(pkg.tests.get('TestBeta')?.action).toBe('skip');
    expect(pkg.tests.get('TestGamma')?.action).toBe('pass');
    expect(pkg.tests.get('TestGamma/ok')?.action).toBe('pass');
  });

  it('reports the tests that failed', () => {
    const { results } = parse(fixture('goTestJsonMixed.jsonl'));
    const pkg = onlyPackage(results);

    expect(pkg.failedTests).toContain('TestAlpha');
    expect(pkg.failedTests).toContain('TestAlpha/sub1');
    expect(pkg.failedTests).not.toContain('TestGamma');
    expect(results.failedPackages).toContain('probe');
  });

  it('records how long each test took', () => {
    const { results } = parse(fixture('goTestJsonMixed.jsonl'));

    const gamma = onlyPackage(results).tests.get('TestGamma');
    expect(gamma).toBeDefined();
    expect(typeof gamma?.elapsed).toBe('number');
  });

  it('keeps the output of the run in the order it was produced', () => {
    const { output } = parse(fixture('goTestJsonMixed.jsonl'));

    expect(output).toContain('=== RUN   TestAlpha');
    expect(output).toContain('--- FAIL: TestAlpha (0.00s)');
    expect(output).toContain('--- PASS: TestGamma (0.00s)');
    expect(output[0]).toBe('=== RUN   TestAlpha');
  });

  it('keeps the output of a single test with that test', () => {
    const { results } = parse(fixture('goTestJsonMixed.jsonl'));

    const output = onlyPackage(results).tests.get('TestAlpha/sub1')?.output ?? [];
    expect(output).toContain('    a_test.go:7: boom');
  });

  it('reports a build failure without a failed test', () => {
    const { results, output, buildOutput } = parse(fixture('goTestJsonBuildFail.jsonl'));

    expect(results.buildFailed).toBe(true);
    expect(onlyPackage(results).failedTests).toEqual([]);
    expect(buildOutput.join('\n')).toContain('undefined: undefinedFunction');
    // The build error is kept apart from the output of the run.
    expect(output.join('\n')).not.toContain('undefinedFunction');
  });

  it('reports the package that did not build as failed', () => {
    const { results } = parse(fixture('goTestJsonBuildFail.jsonl'));

    const pkg = packageOf(results, 'probe');
    expect(pkg.failed).toBe(true);
    expect(pkg.buildFailed).toBe(true);
  });

  it('reports a panic as a failed test', () => {
    const { results, output } = parse(fixture('goTestJsonPanic.jsonl'));

    expect(onlyPackage(results).failedTests).toContain('TestPanic');
    expect(output.join('\n')).toContain('panic: kaboom');
  });

  it('reports no failure when every test passes', () => {
    const { results } = parse(fixture('goTestJsonPass.jsonl'));

    expect(onlyPackage(results).failedTests).toEqual([]);
    expect(results.buildFailed).toBe(false);
    expect(onlyPackage(results).tests.get('TestAllPass')?.action).toBe('pass');
  });

  it('keeps a line that is not an event as output', () => {
    const { output } = parse(
      'not an event\n{"Action":"output","Package":"p","Test":"TestA","Output":"=== RUN   TestA\\n"}\n',
    );

    expect(output[0]).toBe('not an event');
    expect(output).toContain('=== RUN   TestA');
  });

  it('keeps the whole output of a tool that does not emit events', () => {
    const { output, results } = parse('--- FAIL: TestA (0.00s)\nFAIL\n');

    expect(output).toEqual(['--- FAIL: TestA (0.00s)', 'FAIL']);
    expect(results.packages.size).toBe(0);
  });

  it('reads a line that was split across two chunks', () => {
    const text = '{"Action":"fail","Package":"p","Test":"TestA","Elapsed":0}\n';
    const parser = new GoTestJsonParser();

    parser.write(text.substring(0, 20));
    parser.write(text.substring(20));

    expect(packageOf(parser.results, 'p').failedTests).toEqual(['TestA']);
  });

  it('reads a whole stream that arrives in one chunk', () => {
    const parser = new GoTestJsonParser();
    parser.write(fixture('goTestJsonMixed.jsonl'));

    expect(onlyPackage(parser.results).tests.size).toBeGreaterThan(0);
  });

  it('reads the last line when the stream does not end with a newline', () => {
    const parser = new GoTestJsonParser();
    parser.write('{"Action":"fail","Package":"p","Test":"TestA"}');

    // The line is not complete, so nothing has been read yet.
    expect(parser.results.packages.size).toBe(0);
    parser.end();
    expect(packageOf(parser.results, 'p').failedTests).toEqual(['TestA']);
  });

  it('ignores a JSON object that is not an event', () => {
    const { output, results } = parse('{"not":"an event"}\n');

    expect(output).toEqual(['{"not":"an event"}']);
    expect(results.packages.size).toBe(0);
  });
});

describe('GoTestJsonParser with several packages', () => {
  const twoPackages =
    [
      '{"Action":"start","Package":"example.com/mod/one"}',
      '{"Action":"run","Package":"example.com/mod/one","Test":"TestShared"}',
      '{"Action":"output","Package":"example.com/mod/one","Test":"TestShared","Output":"=== RUN   TestShared\\n"}',
      '{"Action":"fail","Package":"example.com/mod/one","Test":"TestShared","Elapsed":0}',
      '{"Action":"fail","Package":"example.com/mod/one","Elapsed":0}',
      '{"Action":"start","Package":"example.com/mod/two"}',
      '{"Action":"run","Package":"example.com/mod/two","Test":"TestShared"}',
      '{"Action":"output","Package":"example.com/mod/two","Test":"TestShared","Output":"=== RUN   TestShared\\n"}',
      '{"Action":"pass","Package":"example.com/mod/two","Test":"TestShared","Elapsed":0}',
      '{"Action":"pass","Package":"example.com/mod/two","Elapsed":0}',
    ].join('\n') + '\n';

  it('keeps the outcome of each package apart', () => {
    const { results } = parse(twoPackages);

    expect(results.packages.size).toBe(2);
    expect(packageOf(results, 'example.com/mod/one').failedTests).toEqual(['TestShared']);
    expect(packageOf(results, 'example.com/mod/two').failedTests).toEqual([]);
  });

  it('marks only the package that failed as failed', () => {
    const { results } = parse(twoPackages);

    expect(packageOf(results, 'example.com/mod/one').failed).toBe(true);
    expect(packageOf(results, 'example.com/mod/two').failed).toBe(false);
  });

  it('keeps the output of each package apart', () => {
    const { results } = parse(twoPackages);

    expect(packageOf(results, 'example.com/mod/one').output.join('\n')).toContain(
      '=== RUN   TestShared',
    );
    expect(packageOf(results, 'example.com/mod/two').output.join('\n')).toContain(
      '=== RUN   TestShared',
    );
  });

  it('reports the packages that failed', () => {
    const { results } = parse(twoPackages);

    expect(results.failedPackages).toEqual(['example.com/mod/one']);
  });

  it('names the package that did not build', () => {
    const { results } = parse(
      [
        '{"Action":"build-output","ImportPath":"example.com/mod/one [example.com/mod/one.test]","Output":"boom\\n"}',
        '{"Action":"build-fail","ImportPath":"example.com/mod/one [example.com/mod/one.test]"}',
        '{"Action":"start","Package":"example.com/mod/one"}',
        '{"Action":"fail","Package":"example.com/mod/one","Elapsed":0,"FailedBuild":"example.com/mod/one [example.com/mod/one.test]"}',
      ].join('\n') + '\n',
    );

    expect(packageOf(results, 'example.com/mod/one').buildFailed).toBe(true);
    expect(results.buildFailed).toBe(true);
  });
});

describe('hasFailed', () => {
  it('finds a test that failed on its own', () => {
    expect(hasFailed(['TestAlpha'], 'TestAlpha')).toBe(true);
  });

  it('finds a test whose subtest failed', () => {
    expect(hasFailed(['TestAlpha/sub1'], 'TestAlpha')).toBe(true);
  });

  it('finds a test whose subtest of a subtest failed', () => {
    expect(hasFailed(['TestAlpha/sub1/deep'], 'TestAlpha')).toBe(true);
  });

  it('does not find a test whose sibling failed', () => {
    expect(hasFailed(['TestAlpha/sub1'], 'TestBeta')).toBe(false);
  });

  it('does not find a test whose own name is a prefix of another test', () => {
    // `TestAlphaExtra` is a different test from `TestAlpha`.
    expect(hasFailed(['TestAlphaExtra'], 'TestAlpha')).toBe(false);
  });

  it('does not find a test that did not fail', () => {
    expect(hasFailed([], 'TestAlpha')).toBe(false);
  });
});

describe('GoTestJsonParser reports a test when it finishes', () => {
  function lines(name: string): string[] {
    return fixture(name)
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line + '\n');
  }

  it('reports the outcome of every test, subtests included', () => {
    const finished: FinishedTest[] = [];
    const parser = new GoTestJsonParser((test) => finished.push(test));

    parser.write(fixture('goTestJsonMixed.jsonl'));
    parser.end();

    expect(finished.map((t) => [t.name, t.passed])).toEqual([
      ['TestAlpha/sub1', false],
      ['TestAlpha', false],
      ['TestBeta', true],
      ['TestGamma/ok', true],
      ['TestGamma', true],
    ]);
  });

  it('reports a test before the rest of the stream has arrived', () => {
    const finished: string[] = [];
    const parser = new GoTestJsonParser((test) => finished.push(test.name));
    const stream = lines('goTestJsonMixed.jsonl');
    const lastAlpha = stream.findIndex((line) =>
      /"Action":"fail".*"Test":"TestAlpha"[,}]/.test(line),
    );
    expect(lastAlpha).toBeGreaterThan(0);

    stream.slice(0, lastAlpha + 1).forEach((line) => parser.write(line));

    // TestBeta and TestGamma have not been read yet.
    expect(finished).toEqual(['TestAlpha/sub1', 'TestAlpha']);
  });

  it('reports the output the test produced', () => {
    const finished: FinishedTest[] = [];
    const parser = new GoTestJsonParser((test) => finished.push(test));

    parser.write(fixture('goTestJsonMixed.jsonl'));

    const alpha = finished.find((t) => t.name === 'TestAlpha/sub1');
    expect(alpha?.output.length).toBeGreaterThan(0);
  });

  it('fails a test whose subtest failed, even when the tool says it passed', () => {
    const finished: FinishedTest[] = [];
    const parser = new GoTestJsonParser((test) => finished.push(test));
    const event = (action: string, test: string) =>
      JSON.stringify({ Action: action, Package: 'p', Test: test, Elapsed: 0 }) + '\n';

    parser.write(event('run', 'TestA') + event('run', 'TestA/sub'));
    parser.write(event('fail', 'TestA/sub') + event('pass', 'TestA'));

    expect(finished.find((t) => t.name === 'TestA')?.passed).toBe(false);
  });

  it('keeps reading when the listener throws', () => {
    const parser = new GoTestJsonParser(() => {
      throw new Error('listener failed');
    });

    parser.write(fixture('goTestJsonMixed.jsonl'));
    parser.end();

    expect(onlyPackage(parser.results).tests.size).toBe(5);
  });
});
