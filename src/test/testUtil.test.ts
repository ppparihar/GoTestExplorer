import { describe, it, expect } from 'vitest';
import { expandFilePathInOutputLine } from '../lib/testUtil';

const cwd = '/repo';

describe('expandFilePathInOutputLine', () => {
  it('makes the path of a file absolute', () => {
    expect(expandFilePathInOutputLine('alpha_test.go:8: boom', cwd)).toBe(
      '/repo/alpha_test.go:8: boom',
    );
  });

  it('leaves a path that is already absolute alone', () => {
    expect(expandFilePathInOutputLine('/other/alpha_test.go:8: boom', cwd)).toBe(
      '/other/alpha_test.go:8: boom',
    );
  });

  it('makes the path of a file in a directory absolute', () => {
    expect(expandFilePathInOutputLine('pkg/alpha_test.go:8: boom', cwd)).toBe(
      '/repo/pkg/alpha_test.go:8: boom',
    );
  });

  it('makes every path of a line absolute', () => {
    const line = 'alpha_test.go:8: boom and beta_test.go:9: bang';

    expect(expandFilePathInOutputLine(line, cwd)).toBe(
      '/repo/alpha_test.go:8: boom and /repo/beta_test.go:9: bang',
    );
  });

  it('expands the path of the message, not the one that is named before it', () => {
    const line = 'see alpha_test.go for details: alpha_test.go:8: boom';

    expect(expandFilePathInOutputLine(line, cwd)).toBe(
      'see alpha_test.go for details: /repo/alpha_test.go:8: boom',
    );
  });

  it('leaves a line without a path alone', () => {
    expect(expandFilePathInOutputLine('# github.com/x/y', cwd)).toBe('# github.com/x/y');
  });

  it('leaves a file that is named without a line number alone', () => {
    expect(expandFilePathInOutputLine('cannot read alpha_test.go', cwd)).toBe(
      'cannot read alpha_test.go',
    );
  });

  it('leaves an empty line alone', () => {
    expect(expandFilePathInOutputLine('', cwd)).toBe('');
  });
});
