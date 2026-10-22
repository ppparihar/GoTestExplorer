/**
 * Glob patterns for choosing which paths of a workspace are loaded.
 *
 * The patterns are the ones of `files.exclude`, matched against a path
 * relative to the workspace folder, written with `/`:
 *
 *   - `*` matches any characters but `/`, and `?` one of them
 *   - `**` matches any number of folders, none included
 *   - `{a,b}` matches either, and `[abc]` or `[!abc]` one character of a set
 *
 * This module deliberately has no dependency on `vscode`, so that it can be
 * unit tested without an extension host.
 */

/**
 * Turns a glob into the regular expression that matches the same paths.
 */
export function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  return new RegExp('^' + convert(source) + '$');
}

function convert(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        // `**/` is any number of folders, and a `**` at the end is anything.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      out += '[^/]';
      i += 1;
    } else if (char === '{') {
      const close = closingBrace(glob, i);
      if (close === -1) {
        out += '\\{';
        i += 1;
      } else {
        const alternatives = splitAlternatives(glob.slice(i + 1, close));
        out += '(?:' + alternatives.map(convert).join('|') + ')';
        i = close + 1;
      }
    } else if (char === '[') {
      const close = glob.indexOf(']', i + 2);
      if (close === -1) {
        out += '\\[';
        i += 1;
      } else {
        const set = glob.slice(i + 1, close);
        out += '[' + (set.startsWith('!') ? '^' + escapeSet(set.slice(1)) : escapeSet(set)) + ']';
        i = close + 1;
      }
    } else {
      out += escapeRegExp(char);
      i += 1;
    }
  }
  return out;
}

/** The index of the brace that closes the one at `open`, or -1. */
function closingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') {
      depth++;
    } else if (glob[i] === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Splits the inside of a brace on the commas that are not in a nested one. */
function splitAlternatives(inside: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] === '{') {
      depth++;
    } else if (inside[i] === '}') {
      depth--;
    } else if (inside[i] === ',' && depth === 0) {
      parts.push(inside.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inside.slice(start));
  return parts;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+^$()|\\/-]/g, '\\$&');
}

function escapeSet(text: string): string {
  return text.replace(/[\\\]^]/g, '\\$&');
}

/**
 * Makes a function that tells whether a relative path matches any of the
 * patterns. A path matches when it, or a folder above it, does: a folder that
 * is left out takes its contents with it.
 */
export function createMatcher(patterns: readonly string[]): (relativePath: string) => boolean {
  const expressions = patterns.filter((p) => p.trim() !== '').map(globToRegExp);
  if (expressions.length === 0) {
    return () => false;
  }
  return (relativePath: string) => {
    const segments = relativePath.split('/').filter((s) => s !== '');
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix === '' ? segment : prefix + '/' + segment;
      if (expressions.some((expression) => expression.test(prefix))) {
        return true;
      }
    }
    return false;
  };
}
