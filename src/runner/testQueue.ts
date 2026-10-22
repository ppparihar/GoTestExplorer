import { TestConfig } from '../lib/testUtil';
import { RawTestResult } from '../rawTestResult';

/**
 * Runs queued test invocations with a bounded degree of parallelism.
 *
 * The queue owns the count of in-flight runs. That count is decremented in a
 * `finally` block on every path — success, failure, or rejection — because a
 * leak would permanently exhaust the parallelism budget, and the extension
 * would silently stop running any further test with no error shown.
 */
export class TestQueue {
  private readonly queue: TestConfig[] = [];
  private inFlight: number = 0;

  /**
   * @param run executes a single test invocation.
   * @param maxParallel the maximum number of concurrent invocations. It may
   * be a function, so that a limit the user can change is read again for
   * every run.
   * @param onCompleted called when a run produced a result.
   * @param onFailed called when a run threw or rejected.
   */
  constructor(
    private readonly run: (config: TestConfig) => Promise<RawTestResult>,
    private readonly maxParallel: number | (() => number),
    private readonly onCompleted: (config: TestConfig, result: RawTestResult) => void,
    private readonly onFailed: (config: TestConfig, error: Error) => void,
  ) {}

  /**
   * The number of invocations that may be in flight at the same time.
   */
  private get limit(): number {
    const value = typeof this.maxParallel === 'function' ? this.maxParallel() : this.maxParallel;
    return typeof value === 'number' && value >= 1 ? Math.floor(value) : 1;
  }

  /**
   * Queues a test invocation and starts it if the parallelism budget allows.
   */
  enqueue(config: TestConfig): void {
    this.queue.push(config);
    this.drain();
  }

  /**
   * The number of invocations waiting to start.
   */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * The number of invocations currently running.
   */
  get running(): number {
    return this.inFlight;
  }

  /**
   * Drops the invocations that have not started yet.
   *
   * The invocations that are already running are not stopped here: the
   * caller kills them, and each of them reports its own outcome.
   */
  cancel(): void {
    this.queue.length = 0;
  }

  private drain(): void {
    while (this.inFlight < this.limit && this.queue.length > 0) {
      const config = this.queue.shift();
      this.start(config);
    }
  }

  private start(config: TestConfig): void {
    this.inFlight++;
    try {
      const promise = this.run(config);
      promise.then(
        (result) => this.finish(config, result, undefined),
        (error) => this.finish(config, undefined, toError(error)),
      );
    } catch (e) {
      // `run` threw synchronously; treat it exactly like a rejection.
      this.finish(config, undefined, toError(e));
    }
  }

  private finish(config: TestConfig, result: RawTestResult, error: Error | undefined): void {
    this.inFlight--;
    try {
      if (error) {
        this.onFailed(config, error);
      } else {
        this.onCompleted(config, result);
      }
    } finally {
      // Keep the parallelism budget saturated, and never let a throw from
      // a callback leave the queue stalled.
      this.drain();
    }
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
