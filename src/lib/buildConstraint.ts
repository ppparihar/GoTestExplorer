/**
 * Pure helpers for Go build constraints: the `//go:build` line at the top of a
 * file, and the `_linux`, `_arm64` endings of a file name.
 *
 * The tree uses them to tell a test file that `go test` will leave out, with
 * the build tags in force, from one it will run. A file that is left out
 * produces "no tests to run", which looks like a pass.
 *
 * This module deliberately has no dependency on `vscode`, so that it can be
 * unit tested without an extension host.
 */

const KNOWN_GOOS = [
  'aix',
  'android',
  'darwin',
  'dragonfly',
  'freebsd',
  'hurd',
  'illumos',
  'ios',
  'js',
  'linux',
  'nacl',
  'netbsd',
  'openbsd',
  'plan9',
  'solaris',
  'wasip1',
  'windows',
  'zos',
];

const KNOWN_GOARCH = [
  '386',
  'amd64',
  'amd64p32',
  'arm',
  'armbe',
  'arm64',
  'arm64be',
  'loong64',
  'mips',
  'mipsle',
  'mips64',
  'mips64le',
  'mips64p32',
  'mips64p32le',
  'ppc',
  'ppc64',
  'ppc64le',
  'riscv',
  'riscv64',
  's390',
  's390x',
  'sparc',
  'sparc64',
  'wasm',
];

/** The systems that the `unix` tag stands for. */
const UNIX_GOOS = [
  'aix',
  'android',
  'darwin',
  'dragonfly',
  'freebsd',
  'hurd',
  'illumos',
  'ios',
  'linux',
  'netbsd',
  'openbsd',
  'solaris',
];

/**
 * Tags that depend on how the tool is run, which is not known here. A
 * constraint that turns on one of them is not decided, so its file is never
 * reported as left out.
 */
const UNDECIDED_TAGS = ['cgo', 'race', 'msan', 'asan', 'boringcrypto'];

/** The system and the architecture the tests are run on. */
export interface Platform {
  goos: string;
  goarch: string;
}

/**
 * The platform of the machine, in the names Go uses.
 */
export function currentPlatform(): Platform {
  const goos: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
    freebsd: 'freebsd',
    openbsd: 'openbsd',
    sunos: 'solaris',
    aix: 'aix',
    android: 'android',
  };
  const goarch: Record<string, string> = {
    x64: 'amd64',
    arm64: 'arm64',
    ia32: '386',
    arm: 'arm',
    ppc64: 'ppc64',
    s390x: 's390x',
    mips: 'mips',
    mipsel: 'mipsle',
    riscv64: 'riscv64',
    loong64: 'loong64',
  };
  return {
    goos: goos[process.platform] ?? process.platform,
    goarch: goarch[process.arch] ?? process.arch,
  };
}

/**
 * The build tags in a setting: names separated by commas, or by spaces.
 */
export function parseTags(setting: string | undefined): Set<string> {
  return new Set((setting ?? '').split(/[,\s]+/).filter((tag) => tag !== ''));
}

/**
 * The build constraint of a file, as an expression, or undefined when it has
 * none.
 *
 * The constraint is a `//go:build` line among the comments at the top of the
 * file, before the package clause. The older `// +build` lines are read too,
 * and turned into the same kind of expression: the words of a line are
 * alternatives, a comma joins tags, and the lines must all hold.
 */
export function constraintOf(text: string): string | undefined {
  const legacy: string[] = [];
  let inBlockComment = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inBlockComment) {
      inBlockComment = !line.includes('*/');
      continue;
    }
    if (line === '') {
      continue;
    }
    if (line.startsWith('/*')) {
      inBlockComment = !line.includes('*/');
      continue;
    }
    if (!line.startsWith('//')) {
      // The package clause, or code: the constraints are above it.
      break;
    }
    const build = /^\/\/go:build\s+(.+)$/.exec(line);
    if (build) {
      return build[1].trim();
    }
    const plus = /^\/\/\s*\+build\s+(.+)$/.exec(line);
    if (plus) {
      const alternatives = plus[1]
        .trim()
        .split(/\s+/)
        .map((term) => '(' + term.split(',').join(' && ') + ')');
      legacy.push('(' + alternatives.join(' || ') + ')');
    }
  }
  return legacy.length > 0 ? legacy.join(' && ') : undefined;
}

type Tri = boolean | undefined;

const and = (a: Tri, b: Tri): Tri =>
  a === false || b === false ? false : a === true && b === true ? true : undefined;
const or = (a: Tri, b: Tri): Tri =>
  a === true || b === true ? true : a === false && b === false ? false : undefined;
const not = (a: Tri): Tri => (a === undefined ? undefined : !a);

/**
 * Whether one tag holds: true, false, or undefined when it is not known.
 */
function tagHolds(tag: string, tags: ReadonlySet<string>, platform: Platform): Tri {
  if (tags.has(tag)) {
    return true;
  }
  if (tag === platform.goos || tag === platform.goarch || tag === 'gc') {
    return true;
  }
  if (tag === 'unix') {
    return UNIX_GOOS.includes(platform.goos);
  }
  if (/^go1\.\d+$/.test(tag)) {
    return true;
  }
  if (UNDECIDED_TAGS.includes(tag) || tag.startsWith('goexperiment.')) {
    return undefined;
  }
  // Any other name is a tag of the user's, which holds only when it is set.
  return false;
}

/**
 * Whether the constraint holds with the tags that are set: true, false, or
 * undefined when it depends on something that is not known here.
 *
 * An expression that cannot be read is not decided either, so the file is
 * never reported as left out because of a constraint that was not understood.
 */
export function evaluateConstraint(
  expression: string,
  tags: ReadonlySet<string>,
  platform: Platform,
): Tri {
  const tokens = expression.match(/\(|\)|!|&&|\|\||[A-Za-z0-9_.]+/g) ?? [];
  let position = 0;
  let failed = false;

  const peek = () => tokens[position];
  const parseOr = (): Tri => {
    let value = parseAnd();
    while (peek() === '||') {
      position++;
      value = or(value, parseAnd());
    }
    return value;
  };
  const parseAnd = (): Tri => {
    let value = parseNot();
    while (peek() === '&&') {
      position++;
      value = and(value, parseNot());
    }
    return value;
  };
  const parseNot = (): Tri => {
    if (peek() === '!') {
      position++;
      return not(parseNot());
    }
    if (peek() === '(') {
      position++;
      const value = parseOr();
      if (peek() === ')') {
        position++;
      } else {
        failed = true;
      }
      return value;
    }
    const tag = tokens[position];
    if (tag === undefined || /^(\)|&&|\|\|)$/.test(tag)) {
      failed = true;
      return undefined;
    }
    position++;
    return tagHolds(tag, tags, platform);
  };

  const value = parseOr();
  if (failed || position !== tokens.length) {
    return undefined;
  }
  return value;
}

/**
 * Whether the name of a file leaves it out on this platform. A name that ends
 * in a system or an architecture (`a_linux_test.go`, `a_arm64_test.go`, or
 * both) holds only on that one.
 */
export function nameExcludes(fileName: string, platform: Platform): boolean {
  const stem = fileName.replace(/_test\.go$/, '').replace(/\.go$/, '');
  const parts = stem.split('_');
  if (parts.length < 2) {
    return false;
  }
  const last = parts[parts.length - 1];
  const before = parts.length >= 3 ? parts[parts.length - 2] : undefined;
  if (KNOWN_GOARCH.includes(last)) {
    if (before !== undefined && KNOWN_GOOS.includes(before)) {
      return before !== platform.goos || last !== platform.goarch;
    }
    return last !== platform.goarch;
  }
  if (KNOWN_GOOS.includes(last)) {
    return last !== platform.goos;
  }
  return false;
}

/**
 * Whether `go test` leaves a test file out, with the tags that are set.
 *
 * It is true only when that is certain: a constraint that depends on
 * something that is not known here does not leave the file out.
 */
export function isExcluded(
  file: { name: string; constraint?: string },
  tags: ReadonlySet<string>,
  platform: Platform = currentPlatform(),
): boolean {
  if (nameExcludes(file.name, platform)) {
    return true;
  }
  return (
    file.constraint !== undefined && evaluateConstraint(file.constraint, tags, platform) === false
  );
}
