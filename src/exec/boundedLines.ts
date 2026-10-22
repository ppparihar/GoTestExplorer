/**
 * Keeps the lines of an output, up to a limit.
 *
 * A test that logs without end, or a run of thousands of verbose tests, would
 * otherwise be held in memory in full. The first lines are kept, because they
 * show how the output began, and so are the last ones, because a failure and a
 * panic are at the end. What lies between is dropped, and a line says how much.
 */
export class BoundedLines {
  private readonly head: string[] = [];
  private readonly tail: string[] = [];
  private tailStart = 0;
  private omittedCount = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  /**
   * @param limit the most lines that are kept, apart from the one that says
   * how many were dropped.
   */
  constructor(limit: number) {
    // A tenth for the beginning, the rest for the end.
    this.headLimit = Math.max(1, Math.floor(limit / 10));
    this.tailLimit = Math.max(1, limit - this.headLimit);
  }

  /** How many lines were dropped. */
  get omitted(): number {
    return this.omittedCount;
  }

  /** Adds a line. */
  add(line: string): void {
    if (this.head.length < this.headLimit) {
      this.head.push(line);
      return;
    }
    if (this.tail.length < this.tailLimit) {
      this.tail.push(line);
      return;
    }
    // The tail is full, so the oldest line of it makes room for this one.
    this.tail[this.tailStart] = line;
    this.tailStart = (this.tailStart + 1) % this.tailLimit;
    this.omittedCount++;
  }

  /** Adds several lines. */
  addAll(lines: readonly string[]): void {
    for (const line of lines) {
      this.add(line);
    }
  }

  /** The lines that were kept, in order, with a line where some were dropped. */
  toArray(): string[] {
    const tail = this.tail.slice(this.tailStart).concat(this.tail.slice(0, this.tailStart));
    if (this.omittedCount === 0) {
      return this.head.concat(tail);
    }
    return this.head.concat([`... ${this.omittedCount} lines omitted ...`], tail);
  }
}

/** The most lines kept for the output of one test. */
export const MAX_TEST_LINES = 1000;
/** The most lines kept for the output of one package. */
export const MAX_PACKAGE_LINES = 5000;
/** The most lines kept for the output of one run. */
export const MAX_RUN_LINES = 20000;
