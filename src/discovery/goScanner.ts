/**
 * An in-process scanner that finds Go test functions in a source file.
 *
 * This replaces the `go-outline` integration, which cost one process spawn,
 * one document open and one byte-offset conversion per test file. The scanner
 * reads the text once and returns the name and source position of every
 * top-level `func TestXxx(...)` declaration.
 *
 * The scanner is deliberately not a Go parser. It is a lexer that knows enough
 * about Go's lexical structure to avoid being fooled by the things that look
 * like a test declaration but are not:
 *
 * - line comments and block comments
 * - interpreted strings (`"..."`), raw strings (`` `...` ``) and rune literals
 * - method receivers (`func (t *T) TestX()` is a method, not a test)
 * - function literals (`var f = func() {}`) and nested declarations
 * - generic functions (`func TestXxx[T any](t *testing.T)`)
 *
 * When the source cannot be lexed with confidence — an unterminated literal
 * or comment, or unbalanced braces — the result is flagged as not confident so
 * the caller can fall back to another strategy instead of silently reporting
 * fewer tests than the file actually contains.
 */

import * as fs from 'fs';
import { constraintOf } from '../lib/buildConstraint';

/** A test function declaration found in a Go source file. */
export interface GoTestDecl {
  /** The declared name, for example `TestAlpha`. */
  readonly name: string;
  /** Zero-based line the declaration starts on. */
  readonly line: number;
  /** Zero-based column of the first character of the name. */
  readonly startChar: number;
  /** Zero-based column just past the last character of the name. */
  readonly endChar: number;
  /**
   * True when the parameter list mentions `testing.T`, `testing.B` or
   * `testing.F`, which is what the Go toolchain requires of a test
   * function.
   */
  readonly usesTesting: boolean;
}

/** The outcome of scanning a Go source file. */
export interface ScanResult {
  /** Every test declaration found, in source order. */
  readonly declarations: readonly GoTestDecl[];
  /**
   * False when the source could not be scanned with confidence, in which case
   * `declarations` may be incomplete.
   */
  readonly confident: boolean;
  /** Why the scan was not confident, when it was not. */
  readonly reason?: string;
  /**
   * The build constraint of the file, as an expression such as
   * `functional && !slow`, when it has one.
   */
  readonly constraint?: string;
}

const CHAR_TAB = 9;
const CHAR_NEWLINE = 10;
const CHAR_CARRIAGE_RETURN = 13;
const CHAR_SPACE = 32;
const CHAR_QUOTE = 34;
const CHAR_APOSTROPHE = 39;
const CHAR_OPEN_PAREN = 40;
const CHAR_CLOSE_PAREN = 41;
const CHAR_ASTERISK = 42;
const CHAR_SLASH = 47;
const CHAR_BACKSLASH = 92;
const CHAR_ZERO = 48;
const CHAR_NINE = 57;
const CHAR_UPPER_A = 65;
const CHAR_UPPER_Z = 90;
const CHAR_UNDERSCORE = 95;
const CHAR_BACKTICK = 96;
const CHAR_LOWER_A = 97;
const CHAR_LOWER_F = 102;
const CHAR_LOWER_Z = 122;
const CHAR_OPEN_BRACKET = 91;
const CHAR_CLOSE_BRACKET = 93;
const CHAR_OPEN_BRACE = 123;
const CHAR_CLOSE_BRACE = 125;

/** A declaration before it is converted to line and column positions. */
interface RawDecl {
  readonly name: string;
  readonly nameOffset: number;
  readonly usesTesting: boolean;
}

function isIdentStart(code: number): boolean {
  return (
    (code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z) ||
    (code >= CHAR_LOWER_A && code <= CHAR_LOWER_Z) ||
    code === CHAR_UNDERSCORE
  );
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || (code >= CHAR_ZERO && code <= CHAR_NINE);
}

function charCodeAt(text: string, index: number): number {
  return index >= 0 && index < text.length ? text.charCodeAt(index) : 0;
}

/**
 * Advances past whitespace.
 *
 * Newlines are included because Go does not insert a semicolon after the
 * `func` keyword, so `func` and the name it declares may sit on different
 * lines.
 */
function skipSpace(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (
      code === CHAR_SPACE ||
      code === CHAR_TAB ||
      code === CHAR_NEWLINE ||
      code === CHAR_CARRIAGE_RETURN
    ) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Advances past an interpreted string literal, honouring backslash escapes.
 *
 * @returns the index just past the closing quote, or -1 when the literal is
 * not terminated.
 */
function skipInterpretedString(text: string, index: number): number {
  let i = index + 1;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_BACKSLASH) {
      i += 2;
      continue;
    }
    if (code === CHAR_NEWLINE) {
      // An interpreted string cannot span a line, so the file is broken.
      return -1;
    }
    if (code === CHAR_QUOTE) {
      return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Advances past a rune literal, honouring backslash escapes.
 *
 * @returns the index just past the closing quote, or -1 when the literal is
 * not terminated.
 */
function skipRune(text: string, index: number): number {
  let i = index + 1;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_BACKSLASH) {
      i += 2;
      continue;
    }
    if (code === CHAR_NEWLINE) {
      return -1;
    }
    if (code === CHAR_APOSTROPHE) {
      return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Finds the index of the bracket that closes the one at `index`.
 *
 * Only the given bracket type is counted; brackets of other types are
 * ignored, which is safe because Go's brackets are individually balanced.
 * String and comment literals inside the brackets are skipped, so a `]` in a
 * string cannot end a type parameter list early.
 *
 * @returns the index of the closing bracket, or -1 when it is not found.
 */
function matchBracket(text: string, index: number, open: number, close: number): number {
  let depth = 0;
  let i = index;
  while (i < text.length) {
    const code = text.charCodeAt(i);

    if (code === CHAR_SLASH) {
      const next = charCodeAt(text, i + 1);
      if (next === CHAR_SLASH) {
        const end = text.indexOf('\n', i + 2);
        i = end === -1 ? text.length : end + 1;
        continue;
      }
      if (next === CHAR_ASTERISK) {
        const end = text.indexOf('*/', i + 2);
        if (end === -1) {
          return -1;
        }
        i = end + 2;
        continue;
      }
      i++;
      continue;
    }

    if (code === CHAR_QUOTE) {
      const end = skipInterpretedString(text, i);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }

    if (code === CHAR_BACKTICK) {
      const end = text.indexOf('`', i + 1);
      if (end === -1) {
        return -1;
      }
      i = end + 1;
      continue;
    }

    if (code === CHAR_APOSTROPHE) {
      const end = skipRune(text, i);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }

    if (code === open) {
      depth++;
    } else if (code === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

interface ParsedFunc {
  readonly decl: RawDecl;
  /** Where the caller should resume scanning. */
  readonly resumeAt: number;
}

/**
 * Parses a test declaration that starts at the `func` keyword.
 *
 * @returns the declaration, or null when the keyword does not introduce a
 * top-level test function.
 */
function parseFuncDecl(text: string, funcOffset: number): ParsedFunc | null {
  let i = skipSpace(text, funcOffset + 4);

  // `func` may be followed by a receiver. A function literal also starts
  // with a parenthesis, but it has no name after it, which is detected
  // below.
  let hasReceiver = false;
  if (charCodeAt(text, i) === CHAR_OPEN_PAREN) {
    hasReceiver = true;
    const end = matchBracket(text, i, CHAR_OPEN_PAREN, CHAR_CLOSE_PAREN);
    if (end === -1) {
      return null;
    }
    i = skipSpace(text, end + 1);
  }

  if (!isIdentStart(charCodeAt(text, i))) {
    return null;
  }
  const nameStart = i;
  while (isIdentPart(charCodeAt(text, i))) {
    i++;
  }
  const name = text.substring(nameStart, i);

  // A method is not a test, however it is named.
  if (hasReceiver) {
    return null;
  }
  if (!name.startsWith('Test')) {
    return null;
  }

  // A generic function has its type parameters between the name and the
  // parameter list.
  i = skipSpace(text, i);
  if (charCodeAt(text, i) === CHAR_OPEN_BRACKET) {
    const end = matchBracket(text, i, CHAR_OPEN_BRACKET, CHAR_CLOSE_BRACKET);
    if (end === -1) {
      return null;
    }
    i = skipSpace(text, end + 1);
  }

  // A test function takes parameters; `func TestFoo` on its own is not one.
  if (charCodeAt(text, i) !== CHAR_OPEN_PAREN) {
    return null;
  }
  const paramsEnd = matchBracket(text, i, CHAR_OPEN_PAREN, CHAR_CLOSE_PAREN);
  if (paramsEnd === -1) {
    return null;
  }
  const params = text.substring(i + 1, paramsEnd);

  return {
    decl: {
      name,
      nameOffset: nameStart,
      usesTesting: /testing\.[TBF]\b/.test(params),
    },
    resumeAt: nameStart + name.length,
  };
}

/**
 * Builds the offset at which each line starts.
 */
function buildLineIndex(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === CHAR_NEWLINE) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Converts an offset into a zero-based line and column.
 */
function lineAndColumn(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { line: low, column: offset - lineStarts[low] };
}

/**
 * Scans Go source text for test function declarations.
 *
 * @param text the contents of a Go source file.
 */
export function scanGoSource(text: string): ScanResult {
  const raw: RawDecl[] = [];
  let i = 0;
  let depth = 0;
  let confident = true;
  let reason: string | undefined;

  while (i < text.length) {
    const code = text.charCodeAt(i);

    if (code === CHAR_SLASH) {
      const next = charCodeAt(text, i + 1);
      if (next === CHAR_SLASH) {
        const end = text.indexOf('\n', i + 2);
        i = end === -1 ? text.length : end + 1;
        continue;
      }
      if (next === CHAR_ASTERISK) {
        const end = text.indexOf('*/', i + 2);
        if (end === -1) {
          confident = false;
          reason = 'unterminated block comment';
          break;
        }
        i = end + 2;
        continue;
      }
      i++;
      continue;
    }

    if (code === CHAR_QUOTE) {
      const end = skipInterpretedString(text, i);
      if (end === -1) {
        confident = false;
        reason = 'unterminated string literal';
        break;
      }
      i = end;
      continue;
    }

    if (code === CHAR_BACKTICK) {
      const end = text.indexOf('`', i + 1);
      if (end === -1) {
        confident = false;
        reason = 'unterminated raw string literal';
        break;
      }
      i = end + 1;
      continue;
    }

    if (code === CHAR_APOSTROPHE) {
      const end = skipRune(text, i);
      if (end === -1) {
        confident = false;
        reason = 'unterminated rune literal';
        break;
      }
      i = end;
      continue;
    }

    if (code === CHAR_OPEN_BRACE) {
      depth++;
      i++;
      continue;
    }

    if (code === CHAR_CLOSE_BRACE) {
      if (depth > 0) {
        depth--;
      }
      i++;
      continue;
    }

    if (
      code === CHAR_LOWER_F &&
      depth === 0 &&
      text.startsWith('func', i) &&
      !isIdentPart(charCodeAt(text, i - 1)) &&
      !isIdentPart(charCodeAt(text, i + 4))
    ) {
      const parsed = parseFuncDecl(text, i);
      if (parsed) {
        raw.push(parsed.decl);
        i = parsed.resumeAt;
        continue;
      }
      i += 4;
      continue;
    }

    i++;
  }

  if (confident && depth !== 0) {
    confident = false;
    reason = 'unbalanced braces';
  }

  const lineStarts = buildLineIndex(text);
  const declarations: GoTestDecl[] = raw.map((decl) => {
    const { line, column } = lineAndColumn(lineStarts, decl.nameOffset);
    return {
      name: decl.name,
      line,
      startChar: column,
      endChar: column + decl.name.length,
      usesTesting: decl.usesTesting,
    };
  });

  return { declarations, confident, reason, constraint: constraintOf(text) };
}

/**
 * Scans a Go file on disk for test function declarations.
 *
 * @param filePath the path of the file to scan.
 */
export async function scanGoFile(filePath: string): Promise<ScanResult> {
  const text = await fs.promises.readFile(filePath, 'utf8');
  return scanGoSource(text);
}
