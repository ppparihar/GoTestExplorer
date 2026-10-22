import { describe, it, expect, afterAll } from 'vitest';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { currentPlatform } from '../lib/buildConstraint';
import { isToolAvailable } from '../lib/testUtil';
import {
  constraintOf,
  evaluateConstraint,
  isExcluded,
  nameExcludes,
  parseTags,
} from '../lib/buildConstraint';

const linux = { goos: 'linux', goarch: 'amd64' };
const tags = (...names: string[]) => new Set(names);

describe('parseTags', () => {
  it('reads commas and spaces', () => {
    expect(Array.from(parseTags('a,b  c'))).toEqual(['a', 'b', 'c']);
    expect(parseTags('').size).toBe(0);
    expect(parseTags(undefined).size).toBe(0);
  });
});

describe('constraintOf', () => {
  it('reads a go:build line above the package clause', () => {
    expect(constraintOf('//go:build functional\n\npackage x\n')).toBe('functional');
  });

  it('skips the comments that come before it', () => {
    expect(
      constraintOf('// Copyright\n/* block\n   comment */\n//go:build a && b\n\npackage x'),
    ).toBe('a && b');
  });

  it('ignores a line below the package clause', () => {
    expect(constraintOf('package x\n\n//go:build functional\n')).toBeUndefined();
  });

  it('turns the older +build lines into an expression', () => {
    expect(constraintOf('// +build a,b c\n// +build !d\n\npackage x')).toBe(
      '((a && b) || (c)) && ((!d))',
    );
  });

  it('is undefined for a file without one', () => {
    expect(constraintOf('package x\n')).toBeUndefined();
  });
});

describe('evaluateConstraint', () => {
  it('holds when the tag is set and not otherwise', () => {
    expect(evaluateConstraint('functional', tags('functional'), linux)).toBe(true);
    expect(evaluateConstraint('functional', tags(), linux)).toBe(false);
  });

  it('knows the system and the architecture', () => {
    expect(evaluateConstraint('linux && amd64', tags(), linux)).toBe(true);
    expect(evaluateConstraint('windows', tags(), linux)).toBe(false);
    expect(evaluateConstraint('unix', tags(), linux)).toBe(true);
    expect(evaluateConstraint('unix', tags(), { goos: 'windows', goarch: 'amd64' })).toBe(false);
  });

  it('follows the precedence of not, and, or', () => {
    expect(evaluateConstraint('a || b && c', tags('a'), linux)).toBe(true);
    expect(evaluateConstraint('(a || b) && c', tags('a'), linux)).toBe(false);
    expect(evaluateConstraint('!a && !b', tags(), linux)).toBe(true);
    expect(evaluateConstraint('a || b', tags(), linux)).toBe(false);
  });

  it('does not decide what depends on how the tool is run', () => {
    expect(evaluateConstraint('cgo', tags(), linux)).toBeUndefined();
    expect(evaluateConstraint('!race', tags(), linux)).toBeUndefined();
    // But a false part still decides an and, and a true part an or.
    expect(evaluateConstraint('cgo && functional', tags(), linux)).toBe(false);
    expect(evaluateConstraint('cgo || linux', tags(), linux)).toBe(true);
  });

  it('does not decide an expression it cannot read', () => {
    expect(evaluateConstraint('a &&', tags('a'), linux)).toBeUndefined();
    expect(evaluateConstraint('(a', tags('a'), linux)).toBeUndefined();
  });
});

describe('nameExcludes', () => {
  it('leaves out a file for another system or architecture', () => {
    expect(nameExcludes('a_windows_test.go', linux)).toBe(true);
    expect(nameExcludes('a_linux_test.go', linux)).toBe(false);
    expect(nameExcludes('a_arm64_test.go', linux)).toBe(true);
    expect(nameExcludes('a_linux_amd64_test.go', linux)).toBe(false);
    expect(nameExcludes('a_linux_arm64_test.go', linux)).toBe(true);
  });

  it('does not read a name that only looks like a system', () => {
    expect(nameExcludes('linux_test.go', linux)).toBe(false);
    expect(nameExcludes('windows_test.go', linux)).toBe(false);
    expect(nameExcludes('guest_ordering_test.go', linux)).toBe(false);
  });
});

describe('isExcluded', () => {
  it('leaves out a file whose tag is not set, and keeps it when it is', () => {
    const file = { name: 'f_test.go', constraint: 'functional' };
    expect(isExcluded(file, tags(), linux)).toBe(true);
    expect(isExcluded(file, tags('functional'), linux)).toBe(false);
  });

  it('keeps a file without a constraint', () => {
    expect(isExcluded({ name: 'f_test.go' }, tags(), linux)).toBe(false);
  });

  it('keeps a file when it cannot tell', () => {
    expect(isExcluded({ name: 'f_test.go', constraint: 'cgo' }, tags(), linux)).toBe(false);
  });
});

describe.skipIf(!isToolAvailable('go'))('agrees with the go tool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-constraint-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Each case: the header of a file, and the tags that are set.
  const cases: Array<[string, string[]]> = [
    ['//go:build functional', []],
    ['//go:build functional', ['functional']],
    ['//go:build functional && !slow', ['functional']],
    ['//go:build functional && !slow', ['functional', 'slow']],
    ['//go:build functional || integration', ['integration']],
    ['//go:build (a || b) && c', ['a']],
    ['//go:build (a || b) && c', ['a', 'c']],
    ['//go:build !windows', []],
    ['//go:build windows', []],
    ['//go:build unix && !functional', []],
    ['//go:build linux && amd64', []],
    ['// +build functional', []],
    ['// +build functional', ['functional']],
    ['// +build a,b c', ['c']],
    ['// +build a,b c', ['a']],
    ['', []],
  ];

  it.each(cases)('reads %j with tags %j as the tool does', (header, set) => {
    const pkg = fs.mkdtempSync(path.join(dir, 'p'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module ex.com/c\n\ngo 1.21\n');
    const rel = path.relative(dir, pkg);
    fs.writeFileSync(path.join(pkg, 'base_test.go'), 'package p\n');
    const text = (header ? header + '\n\n' : '') + 'package p\n';
    fs.writeFileSync(path.join(pkg, 'case_test.go'), text);

    const args = ['list', '-json'];
    if (set.length > 0) {
      args.push('-tags', set.join(','));
    }
    args.push('./' + rel);
    const listed = JSON.parse(cp.execFileSync('go', args, { cwd: dir, encoding: 'utf8' }));
    const included = (listed.TestGoFiles ?? []).includes('case_test.go');

    const file = { name: 'case_test.go', constraint: constraintOf(text) };
    expect(isExcluded(file, parseTags(set.join(',')), currentPlatform())).toBe(!included);
  });
});
