import { describe, it, expect } from 'vitest';
import { scanGoSource } from '../discovery/goScanner';

describe('scanGoSource', () => {
  it('finds a plain test function', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha(t *testing.T) {}\n');
    expect(result.confident).toBe(true);
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('reports the line and column of the name', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha(t *testing.T) {}\n');
    const decl = result.declarations[0];
    expect(decl.line).toBe(2);
    expect(decl.startChar).toBe(5);
    expect(decl.endChar).toBe(14);
  });

  it('reports the position of a name on a later line', () => {
    const result = scanGoSource('package x\n\nfunc\n\tTestAlpha(t *testing.T) {}\n');
    const decl = result.declarations[0];
    expect(decl.name).toBe('TestAlpha');
    expect(decl.line).toBe(3);
    expect(decl.startChar).toBe(1);
  });

  it('finds several test functions in source order', () => {
    const result = scanGoSource(
      [
        'package x',
        '',
        'func TestZeta(t *testing.T) {}',
        '',
        'func TestAlpha(t *testing.T) {}',
      ].join('\n'),
    );
    expect(result.declarations.map((d) => d.name)).toEqual(['TestZeta', 'TestAlpha']);
  });

  it('ignores a method with a receiver', () => {
    const result = scanGoSource('package x\n\nfunc (s *Suite) TestAlpha(t *testing.T) {}\n');
    expect(result.declarations).toEqual([]);
  });

  it('ignores a function that is not a test', () => {
    const result = scanGoSource('package x\n\nfunc helper(t *testing.T) {}\n');
    expect(result.declarations).toEqual([]);
  });

  it('ignores a function whose name only starts with Test in the middle', () => {
    const result = scanGoSource('package x\n\nfunc myTestHelper(t *testing.T) {}\n');
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function nested inside another function', () => {
    const result = scanGoSource(
      ['package x', '', 'func outer() {', '	func TestAlpha(t *testing.T) {}', '}'].join('\n'),
    );
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function inside a function literal', () => {
    const result = scanGoSource(
      ['package x', '', 'var f = func() {', '	func TestAlpha(t *testing.T) {}', '}'].join('\n'),
    );
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function mentioned in a line comment', () => {
    const result = scanGoSource('package x\n\n// func TestAlpha(t *testing.T) {}\n');
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function mentioned in a block comment', () => {
    const result = scanGoSource(
      ['package x', '', '/*', 'func TestAlpha(t *testing.T) {}', '*/'].join('\n'),
    );
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function inside a string literal', () => {
    const result = scanGoSource('package x\n\nconst s = "func TestAlpha(t *testing.T) {}"\n');
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function inside a raw string literal', () => {
    const result = scanGoSource('package x\n\nconst s = `func TestAlpha(t *testing.T) {}`\n');
    expect(result.declarations).toEqual([]);
  });

  it('ignores a test function inside a rune-free struct tag', () => {
    const result = scanGoSource(
      [
        'package x',
        '',
        'type T struct {',
        '	A string `json:"func TestAlpha(t *testing.T) {}"`',
        '}',
      ].join('\n'),
    );
    expect(result.declarations).toEqual([]);
  });

  it('finds a test function that follows a raw string', () => {
    const result = scanGoSource(
      ['package x', '', 'const s = `not a func`', '', 'func TestAlpha(t *testing.T) {}'].join('\n'),
    );
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('finds a test function that follows a string containing braces', () => {
    const result = scanGoSource(
      ['package x', '', 'const s = "{ } \\" "', '', 'func TestAlpha(t *testing.T) {}'].join('\n'),
    );
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('finds a generic test function', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha[T any](t *testing.T) {}\n');
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('finds a test function whose parameter list spans lines', () => {
    const result = scanGoSource(
      ['package x', '', 'func TestAlpha(', '\tt *testing.T,', ') {}'].join('\n'),
    );
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('finds a test function whose parameter list contains a function type', () => {
    const result = scanGoSource(
      'package x\n\nfunc TestAlpha(t *testing.T, done func(int) error) {}\n',
    );
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('ignores a declaration with no parameter list', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha\n');
    expect(result.declarations).toEqual([]);
  });

  it('reports a test that uses testing.T', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha(t *testing.T) {}\n');
    expect(result.declarations[0].usesTesting).toBe(true);
  });

  it('reports a test that does not use testing.T', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha(t *T) {}\n');
    expect(result.declarations[0].usesTesting).toBe(false);
  });

  it('does not treat testing.TB as a testing.T parameter', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha(t *testing.TB) {}\n');
    expect(result.declarations[0].usesTesting).toBe(false);
  });

  it('is not confident about an unterminated string', () => {
    const result = scanGoSource('package x\n\nconst s = "unterminated\n');
    expect(result.confident).toBe(false);
    expect(result.reason).toBe('unterminated string literal');
  });

  it('is not confident about an unterminated block comment', () => {
    const result = scanGoSource('package x\n\n/* never closed\n');
    expect(result.confident).toBe(false);
    expect(result.reason).toBe('unterminated block comment');
  });

  it('is not confident about unbalanced braces', () => {
    const result = scanGoSource('package x\n\nfunc TestAlpha(t *testing.T) {\n');
    expect(result.confident).toBe(false);
    expect(result.reason).toBe('unbalanced braces');
  });

  it('is not confident about an unterminated raw string', () => {
    const result = scanGoSource('package x\n\nconst s = `never closed\n');
    expect(result.confident).toBe(false);
    expect(result.reason).toBe('unterminated raw string literal');
  });

  it('still reports the tests it found when it is not confident', () => {
    const result = scanGoSource(
      ['package x', '', 'func TestAlpha(t *testing.T) {}', '', 'const s = "unterminated'].join(
        '\n',
      ),
    );
    expect(result.confident).toBe(false);
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('handles a brace inside a rune literal', () => {
    const result = scanGoSource(
      ['package x', '', "const c = '{'", '', 'func TestAlpha(t *testing.T) {}'].join('\n'),
    );
    expect(result.confident).toBe(true);
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('handles a brace inside an escaped rune literal', () => {
    const result = scanGoSource(
      ['package x', '', "const c = '\\''", '', 'func TestAlpha(t *testing.T) {}'].join('\n'),
    );
    expect(result.confident).toBe(true);
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('handles a slash that is not a comment', () => {
    const result = scanGoSource(
      [
        'package x',
        '',
        'var a = 10 / 2',
        'var b = a / 2',
        '',
        'func TestAlpha(t *testing.T) {}',
      ].join('\n'),
    );
    expect(result.confident).toBe(true);
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
  });

  it('handles a file that has no tests at all', () => {
    const result = scanGoSource('package x\n\nfunc helper() {}\n');
    expect(result.confident).toBe(true);
    expect(result.declarations).toEqual([]);
  });

  it('handles an empty file', () => {
    const result = scanGoSource('');
    expect(result.confident).toBe(true);
    expect(result.declarations).toEqual([]);
  });

  it('handles Windows line endings', () => {
    const result = scanGoSource('package x\r\n\r\nfunc TestAlpha(t *testing.T) {}\r\n');
    expect(result.declarations.map((d) => d.name)).toEqual(['TestAlpha']);
    expect(result.declarations[0].line).toBe(2);
    expect(result.declarations[0].startChar).toBe(5);
  });
});
