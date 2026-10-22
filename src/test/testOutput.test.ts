import { describe, it, expect, beforeEach } from 'vitest';
import { decorateLine, TestOutput } from '../lib/testOutput';
import { __reset, __state } from './mocks/vscode';

beforeEach(() => {
	__reset();
});

describe('decorateLine', () => {
	it('gives a failure the colour of a failure', () => {
		expect(decorateLine('--- FAIL: TestAlpha (0.00s)')).toBe('\x1b[31m--- FAIL: TestAlpha (0.00s)\x1b[0m');
	});

	it('gives a pass the colour of a pass', () => {
		expect(decorateLine('--- PASS: TestAlpha (0.00s)')).toBe('\x1b[32m--- PASS: TestAlpha (0.00s)\x1b[0m');
	});

	it('gives a skipped test the colour of a warning', () => {
		expect(decorateLine('--- SKIP: TestAlpha (0.00s)')).toBe('\x1b[33m--- SKIP: TestAlpha (0.00s)\x1b[0m');
	});

	it('gives the result of a package the colour of its outcome', () => {
		expect(decorateLine('ok  \tgithub.com/x/y\t0.02s')).toBe('\x1b[32mok  \tgithub.com/x/y\t0.02s\x1b[0m');
		expect(decorateLine('FAIL\tgithub.com/x/y\t0.02s')).toBe('\x1b[31mFAIL\tgithub.com/x/y\t0.02s\x1b[0m');
	});

	it('gives a line of the extension the colour of its meaning', () => {
		expect(decorateLine('Error: Tests failed.')).toBe('\x1b[31mError: Tests failed.\x1b[0m');
		expect(decorateLine('Success: Tests passed.')).toBe('\x1b[32mSuccess: Tests passed.\x1b[0m');
	});

	it('leaves a line that means nothing to it alone', () => {
		expect(decorateLine('    alpha_test.go:8: boom')).toBe('    alpha_test.go:8: boom');
	});
});

describe('TestOutput', () => {
	it('makes no terminal before one is needed', () => {
		new TestOutput('Tests');

		expect(__state.terminals.length).toBe(0);
	});

	it('writes the output to the terminal', () => {
		const output = new TestOutput('Tests');
		output.writeLine('hello');

		output.show();

		const terminal = __state.terminals[__state.terminals.length - 1];
		expect(terminal.name).toBe('Tests');
		expect(terminal.text).toContain('hello');
	});

	it('keeps the output that is written before the terminal is opened', () => {
		const output = new TestOutput('Tests');
		output.writeLine('first');
		output.writeLine('second');

		output.show();

		const terminal = __state.terminals[__state.terminals.length - 1];
		expect(terminal.text).toContain('first');
		expect(terminal.text).toContain('second');
	});

	it('drops the output that is written before the terminal is opened when it is cleared', () => {
		const output = new TestOutput('Tests');
		output.writeLine('stale');
		output.clear();

		output.show();

		const terminal = __state.terminals[__state.terminals.length - 1];
		expect(terminal.text).not.toContain('stale');
	});

	it('clears the terminal that is open', () => {
		const output = new TestOutput('Tests');
		output.show();
		output.writeLine('stale');
		output.clear();

		const terminal = __state.terminals[__state.terminals.length - 1];
		expect(terminal.text).toContain('\x1b[2J');
	});

	it('stops the run when the user presses Ctrl+C', () => {
		const output = new TestOutput('Tests');
		let stopped = 0;
		output.setCancelHandler(() => { stopped++; });
		output.show();

		const terminal = __state.terminals[__state.terminals.length - 1];
		terminal.sendText('\x03');

		expect(stopped).toBe(1);
	});

	it('ignores the input that is not Ctrl+C', () => {
		const output = new TestOutput('Tests');
		let stopped = 0;
		output.setCancelHandler(() => { stopped++; });
		output.show();

		const terminal = __state.terminals[__state.terminals.length - 1];
		terminal.sendText('x');

		expect(stopped).toBe(0);
	});
});
