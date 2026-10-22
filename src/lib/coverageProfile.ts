/**
 * Pure helpers for reading the cover profile that `go test -coverprofile`
 * writes, and for turning it into the lines to mark in an editor.
 *
 * This module deliberately has no dependency on `vscode`, so that it can be
 * unit tested without an extension host.
 */

/**
 * A block of statements of a file, and how often it ran.
 */
export interface CoverBlock {
  /** The first line of the block, counted from 1 as in the profile. */
  startLine: number;
  /** The column the block starts at. */
  startCol: number;
  /** The last line of the block, counted from 1 as in the profile. */
  endLine: number;
  /** The column the block ends at. */
  endCol: number;
  /** The number of statements in the block. */
  statements: number;
  /** How often the block ran. Zero means it was not covered. */
  count: number;
}

/**
 * The blocks of every file of a profile, keyed by the name the profile gives
 * the file: its import path, such as `example.com/mod/pkg/a.go`.
 */
export type CoverProfile = Map<string, CoverBlock[]>;

/**
 * A line of a profile: `name.go:12.3,14.2 2 1`.
 */
const profileLine = /^(.+):(\d+)\.(\d+),(\d+)\.(\d+) (\d+) (\d+)$/;

/**
 * Reads the text of a cover profile. A line that is not a block, such as the
 * `mode:` line at the top, is skipped.
 */
export function parseCoverProfile(text: string): CoverProfile {
  const profile: CoverProfile = new Map();
  for (const raw of text.split('\n')) {
    const match = profileLine.exec(raw.trim());
    if (!match) {
      continue;
    }
    const blocks = profile.get(match[1]) ?? [];
    blocks.push({
      startLine: Number(match[2]),
      startCol: Number(match[3]),
      endLine: Number(match[4]),
      endCol: Number(match[5]),
      statements: Number(match[6]),
      count: Number(match[7]),
    });
    profile.set(match[1], blocks);
  }
  return profile;
}

/**
 * Reads a cover profile that is still being written.
 *
 * The tool appends the blocks of each package to the profile as the package
 * finishes, so the text arrives in pieces, and a piece may end in the middle
 * of a line. Each piece is given to {@link push}, which answers with the files
 * whose blocks it completed, with every block that file has so far.
 */
export class CoverageStream {
  private carry = '';
  private readonly known: CoverProfile = new Map();

  push(text: string): CoverProfile {
    const lines = (this.carry + text).split('\n');
    // The last part is a whole line only when the text ended with a newline.
    this.carry = lines.pop() ?? '';
    const touched: CoverProfile = new Map();
    parseCoverProfile(lines.join('\n')).forEach((blocks, file) => {
      const all = (this.known.get(file) ?? []).concat(blocks);
      this.known.set(file, all);
      touched.set(file, all);
    });
    return touched;
  }
}

/**
 * Joins the profiles of several runs. A file that is in more than one is taken
 * from the last one that has it.
 */
export function mergeCoverProfiles(profiles: readonly CoverProfile[]): CoverProfile {
  const merged: CoverProfile = new Map();
  profiles.forEach((profile) => profile.forEach((blocks, file) => merged.set(file, blocks)));
  return merged;
}

/**
 * Adds what a run covered to what earlier runs covered of the same file.
 *
 * A block ran if it ran in either, so the result never has less coverage than
 * what it started from: a run of one test does not take back what the other
 * tests of the file had covered. A block is the same block when it has the
 * same place in the file.
 */
export function addCoverage(
  known: readonly CoverBlock[],
  run: readonly CoverBlock[],
): CoverBlock[] {
  const key = (b: CoverBlock) => `${b.startLine}.${b.startCol},${b.endLine}.${b.endCol}`;
  const merged = new Map<string, CoverBlock>();
  known.forEach((block) => merged.set(key(block), block));
  run.forEach((block) => {
    const before = merged.get(key(block));
    merged.set(key(block), before ? { ...before, count: before.count + block.count } : block);
  });
  return Array.from(merged.values());
}

/**
 * The lines of a file to mark, counted from 0 as the editor counts them.
 */
export interface MarkedLines {
  covered: number[];
  uncovered: number[];
}

/**
 * The lines of a file that ran, and the lines that did not.
 *
 * Two blocks may share a line, and a line that holds a block that did not run
 * counts as not covered.
 */
export function markedLines(blocks: readonly CoverBlock[]): MarkedLines {
  const uncovered = new Set<number>();
  const covered = new Set<number>();
  blocks.forEach((block) => {
    const target = block.count > 0 ? covered : uncovered;
    for (let line = block.startLine; line <= block.endLine; line++) {
      target.add(line - 1);
    }
  });
  uncovered.forEach((line) => covered.delete(line));
  const ascending = (a: number, b: number) => a - b;
  return {
    covered: Array.from(covered).sort(ascending),
    uncovered: Array.from(uncovered).sort(ascending),
  };
}

/**
 * The share of the statements that ran, from 0 to 100. A file without
 * statements counts as fully covered.
 */
export function coveragePercent(blocks: readonly CoverBlock[]): number {
  const total = blocks.reduce((sum, block) => sum + block.statements, 0);
  if (total === 0) {
    return 100;
  }
  const ran = blocks.reduce((sum, block) => sum + (block.count > 0 ? block.statements : 0), 0);
  return (ran / total) * 100;
}
