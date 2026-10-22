import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GoTestJsonParser, hasFailed } from '../exec/goTestJsonParser';

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

describe('GoTestJsonParser', () => {
	it('reads the outcome of every test from a real run', () => {
		const { results } = parse(fixture('goTestJsonMixed.jsonl'));

		expect(results.tests.get('TestAlpha')?.action).toBe('fail');
		expect(results.tests.get('TestAlpha/sub1')?.action).toBe('fail');
		expect(results.tests.get('TestBeta')?.action).toBe('skip');
		expect(results.tests.get('TestGamma')?.action).toBe('pass');
		expect(results.tests.get('TestGamma/ok')?.action).toBe('pass');
	});

	it('reports the tests that failed', () => {
		const { results } = parse(fixture('goTestJsonMixed.jsonl'));

		expect(results.failedTests).toContain('TestAlpha');
		expect(results.failedTests).toContain('TestAlpha/sub1');
		expect(results.failedTests).not.toContain('TestGamma');
		expect(results.failedPackages).toContain('probe');
	});

	it('records how long each test took', () => {
		const { results } = parse(fixture('goTestJsonMixed.jsonl'));

		const gamma = results.tests.get('TestGamma');
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

		const output = results.tests.get('TestAlpha/sub1')?.output ?? [];
		expect(output).toContain('    a_test.go:7: boom');
	});

	it('reports a build failure without a failed test', () => {
		const { results, output, buildOutput } = parse(fixture('goTestJsonBuildFail.jsonl'));

		expect(results.buildFailed).toBe(true);
		expect(results.failedTests).toEqual([]);
		expect(buildOutput.join('\n')).toContain('undefined: undefinedFunction');
		// The build error is kept apart from the output of the run.
		expect(output.join('\n')).not.toContain('undefinedFunction');
	});

	it('reports a panic as a failed test', () => {
		const { results, output } = parse(fixture('goTestJsonPanic.jsonl'));

		expect(results.failedTests).toContain('TestPanic');
		expect(output.join('\n')).toContain('panic: kaboom');
	});

	it('reports no failure when every test passes', () => {
		const { results } = parse(fixture('goTestJsonPass.jsonl'));

		expect(results.failedTests).toEqual([]);
		expect(results.buildFailed).toBe(false);
		expect(results.tests.get('TestAllPass')?.action).toBe('pass');
	});

	it('keeps a line that is not an event as output', () => {
		const { output } = parse('not an event\n{"Action":"output","Package":"p","Test":"TestA","Output":"=== RUN   TestA\\n"}\n');

		expect(output[0]).toBe('not an event');
		expect(output).toContain('=== RUN   TestA');
	});

	it('keeps the whole output of a tool that does not emit events', () => {
		const { output, results } = parse('--- FAIL: TestA (0.00s)\nFAIL\n');

		expect(output).toEqual(['--- FAIL: TestA (0.00s)', 'FAIL']);
		expect(results.failedTests).toEqual([]);
	});

	it('reads a line that was split across two chunks', () => {
		const text = '{"Action":"fail","Package":"p","Test":"TestA","Elapsed":0}\n';
		const parser = new GoTestJsonParser();

		parser.write(text.substring(0, 20));
		parser.write(text.substring(20));

		expect(parser.results.failedTests).toEqual(['TestA']);
	});

	it('reads a whole stream that arrives in one chunk', () => {
		const parser = new GoTestJsonParser();
		parser.write(fixture('goTestJsonMixed.jsonl'));

		expect(parser.results.tests.size).toBeGreaterThan(0);
	});

	it('reads the last line when the stream does not end with a newline', () => {
		const parser = new GoTestJsonParser();
		parser.write('{"Action":"fail","Package":"p","Test":"TestA"}');

		expect(parser.results.failedTests).toEqual([]);
		parser.end();
		expect(parser.results.failedTests).toEqual(['TestA']);
	});

	it('ignores a JSON object that is not an event', () => {
		const { output, results } = parse('{"not":"an event"}\n');

		expect(output).toEqual(['{"not":"an event"}']);
		expect(results.tests.size).toBe(0);
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
