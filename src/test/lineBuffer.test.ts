import { describe, it, expect } from 'vitest';
import { LineBuffer } from '../lib/utils';

/**
 * Reads every line and the last part through a buffer.
 */
function read(chunks: string[]): { lines: string[]; last: string | null } {
	const buffer = new LineBuffer();
	const lines: string[] = [];
	let last: string | null = null;
	buffer.onLine(line => lines.push(line));
	buffer.onDone(value => last = value);
	chunks.forEach(chunk => buffer.append(chunk));
	buffer.done();
	return { lines, last };
}

describe('LineBuffer', () => {
	it('reports the lines of one chunk', () => {
		const { lines } = read(['one\ntwo\n']);

		expect(lines).toEqual(['one', 'two']);
	});

	it('keeps a line that is split across two chunks', () => {
		const { lines } = read(['on', 'e\ntwo\n']);

		expect(lines).toEqual(['one', 'two']);
	});

	it('keeps a line that is split across three chunks', () => {
		const { lines } = read(['o', 'n', 'e\n']);

		expect(lines).toEqual(['one']);
	});

	it('reports a line that ends without a newline as the last part', () => {
		const { lines, last } = read(['one\ntwo']);

		expect(lines).toEqual(['one']);
		expect(last).toBe('two');
	});

	it('reports nothing as the last part when there is nothing left', () => {
		const { lines, last } = read(['one\n']);

		expect(lines).toEqual(['one']);
		expect(last).toBeNull();
	});

	it('reports nothing for an empty stream', () => {
		const { lines, last } = read([]);

		expect(lines).toEqual([]);
		expect(last).toBeNull();
	});

	it('ignores an empty chunk', () => {
		const { lines } = read(['', 'one\n', '']);

		expect(lines).toEqual(['one']);
	});

	it('keeps an empty line', () => {
		const { lines } = read(['one\n\ntwo\n']);

		expect(lines).toEqual(['one', '', 'two']);
	});

	it('keeps a carriage return that ends a line', () => {
		// Only a newline ends a line, so a carriage return is part of it.
		const { lines } = read(['one\r\ntwo\r\n']);

		expect(lines).toEqual(['one\r', 'two\r']);
	});

	it('keeps a carriage return that does not end a line', () => {
		const { lines } = read(['one\rtwo\n']);

		expect(lines).toEqual(['one\rtwo']);
	});

	it('reports every line of a long stream', () => {
		const expected: string[] = [];
		const chunks: string[] = [];
		for (let i = 0; i < 500; i++) {
			expected.push('line ' + i);
			chunks.push('line ' + i + '\n');
		}

		const { lines } = read(chunks);

		expect(lines.length).toBe(500);
		expect(lines[0]).toBe('line 0');
		expect(lines[499]).toBe('line 499');
	});

	it('reports a line that arrives in one byte at a time', () => {
		const text = 'one\ntwo\nthree\n';
		const { lines } = read(text.split(''));

		expect(lines).toEqual(['one', 'two', 'three']);
	});

	it('reads a large stream without copying it over and over', () => {
		// The earlier implementation kept the text that was left in a string
		// and cut it back for every line, which copies the rest of the
		// stream once per line. The budget is generous: it is there to catch
		// a quadratic implementation, not to measure the speed.
		const buffer = new LineBuffer();
		let lines = 0;
		buffer.onLine(() => lines++);

		const started = Date.now();
		for (let i = 0; i < 200000; i++) {
			buffer.append('line ' + i + '\n');
		}
		buffer.done();
		const elapsed = Date.now() - started;

		expect(lines).toBe(200000);
		expect(elapsed).toBeLessThan(5000);
	});
});
