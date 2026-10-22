import * as vscode from 'vscode';
import { runInTerminal } from './settings';

/**
 * The escape sequences that set the colour of the output.
 */
const reset = '\x1b[0m';
const red = '\x1b[31m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[90m';

/**
 * The lines of the output of a run, and the colour that fits them.
 *
 * The order matters: the first pattern that fits a line decides its colour.
 */
const lineColours: { pattern: RegExp; colour: string }[] = [
  { pattern: /^--- FAIL:/, colour: red },
  { pattern: /^--- PASS:/, colour: green },
  { pattern: /^--- SKIP:/, colour: yellow },
  { pattern: /^=== (RUN|PAUSE|CONT)/, colour: dim },
  { pattern: /^FAIL\b/, colour: red },
  { pattern: /^PASS$/, colour: green },
  { pattern: /^ok\s/, colour: green },
  { pattern: /^\?\s/, colour: dim },
  { pattern: /^Error:/, colour: red },
  { pattern: /^Success:/, colour: green },
  { pattern: /^Running tool:/, colour: dim },
];

/**
 * Adds the colour that fits a line of the output of a run.
 *
 * The output of the tool is plain text, and a terminal can show it with the
 * colour that says what the line means: a failure is red, a pass is green.
 *
 * @param line the line of output.
 * @returns the line, wrapped in the escape sequence of its colour.
 */
export function decorateLine(line: string): string {
  const match = lineColours.find((candidate) => candidate.pattern.test(line));
  if (!match) {
    return line;
  }
  return match.colour + line + reset;
}

/**
 * The output of the test runs, shown in a terminal.
 *
 * A terminal is used instead of an output channel because it keeps a
 * scrollback, because the user can stop a run from it, and because the
 * output of the tool can be given a colour.
 */
export class TestOutput {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private terminal: vscode.Terminal | undefined;
  private opened = false;
  private buffered: string[] = [];
  private cancelHandler: (() => void) | undefined;

  /**
   * @param name the name of the terminal.
   */
  constructor(private readonly name: string = 'Go Test Explorer') {}

  /**
   * Writes text to the terminal as it is.
   *
   * @param text the text to write.
   */
  write(text: string): void {
    // The terminal is made when the first output is written, so that the
    // output of a run that nobody looks at is not lost.
    this.ensureTerminal();
    if (this.opened) {
      this.writeEmitter.fire(text);
      return;
    }
    // A terminal that has not been opened yet drops what is written to
    // it, so the text is kept until the terminal is opened.
    this.buffered.push(text);
  }

  /**
   * Writes a line to the terminal, in the colour that fits it.
   *
   * @param line the line to write.
   */
  writeLine(line: string): void {
    this.write(decorateLine(line) + '\r\n');
  }

  /**
   * Clears the terminal, so the output of the next run is not mixed with
   * the output of the last one.
   */
  clear(): void {
    if (!this.opened) {
      this.buffered = [];
      return;
    }
    // The screen and the scrollback are cleared with the escape
    // sequences of the terminal.
    this.write('\x1b[2J\x1b[3J\x1b[H');
  }

  /**
   * Shows the terminal.
   *
   * @param preserveFocus whether the editor keeps the focus.
   */
  show(preserveFocus: boolean = true): void {
    this.ensureTerminal().show(preserveFocus);
  }

  /**
   * Sets what happens when the user stops the run from the terminal.
   *
   * @param handler the handler, or nothing to leave the terminal alone.
   */
  setCancelHandler(handler: (() => void) | undefined): void {
    this.cancelHandler = handler;
  }

  /**
   * Disposes of the terminal.
   */
  dispose(): void {
    this.writeEmitter.dispose();
    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = undefined;
    }
    this.opened = false;
  }

  /**
   * The terminal the output is written to.
   *
   * The terminal is made when it is first needed, so the extension does
   * not open a terminal of its own when it starts.
   */
  private ensureTerminal(): vscode.Terminal {
    if (!this.terminal) {
      const pty: vscode.Pseudoterminal = {
        onDidWrite: this.writeEmitter.event,
        open: () => {
          this.opened = true;
          const buffered = this.buffered.join('');
          this.buffered = [];
          if (buffered) {
            this.writeEmitter.fire(buffered);
          }
        },
        close: () => {
          this.opened = false;
        },
        handleInput: (data: string) => {
          // Ctrl+C stops the run, the way it stops a command in
          // any other terminal.
          if (data === '\x03') {
            const handler = this.cancelHandler;
            if (handler) {
              handler();
            }
          }
        },
      };
      this.terminal = vscode.window.createTerminal({ name: this.name, pty });
    }
    return this.terminal;
  }
}

/**
 * The output of the test runs, in an output channel.
 *
 * The channel is made when the first output is written, so the extension
 * does not open a channel of its own when it starts.
 */
export class ChannelOutput {
  private channel: vscode.OutputChannel | undefined;

  /**
   * @param name the name of the channel.
   */
  constructor(private readonly name: string = 'Go Test Explorer') {}

  /**
   * Writes text to the channel as it is.
   *
   * @param text the text to write.
   */
  write(text: string): void {
    this.ensureChannel().append(text);
  }

  /**
   * Writes a line to the channel, in the colour that fits it.
   *
   * @param line the line to write.
   */
  writeLine(line: string): void {
    this.ensureChannel().appendLine(decorateLine(line));
  }

  /**
   * Clears the channel, so the output of the next run is not mixed with the
   * output of the last one.
   */
  clear(): void {
    this.ensureChannel().clear();
  }

  /**
   * Shows the channel.
   *
   * @param preserveFocus whether the editor keeps the focus.
   */
  show(preserveFocus: boolean = true): void {
    this.ensureChannel().show(preserveFocus);
  }

  /**
   * Disposes of the channel.
   */
  dispose(): void {
    if (this.channel) {
      this.channel.dispose();
      this.channel = undefined;
    }
  }

  /**
   * The channel the output is written to.
   */
  private ensureChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(this.name);
    }
    return this.channel;
  }
}

/**
 * The output of the test runs.
 *
 * The output goes to a terminal, unless the user asked for an output channel
 * with the `goTestExplorer.runInTerminal` setting.
 */
class TestOutputFacade {
  private readonly terminal = new TestOutput('Go Test Explorer');
  private readonly channel = new ChannelOutput('Go Test Explorer');

  /**
   * Writes text as it is.
   *
   * @param text the text to write.
   */
  write(text: string): void {
    this.sink().write(text);
  }

  /**
   * Writes a line, in the colour that fits it.
   *
   * @param line the line to write.
   */
  writeLine(line: string): void {
    this.sink().writeLine(line);
  }

  /**
   * Clears the output, so the output of the next run is not mixed with the
   * output of the last one.
   */
  clear(): void {
    this.sink().clear();
  }

  /**
   * Shows the output.
   *
   * @param preserveFocus whether the editor keeps the focus.
   */
  show(preserveFocus: boolean = true): void {
    this.sink().show(preserveFocus);
  }

  /**
   * Sets what happens when the user stops the run from the terminal.
   *
   * @param handler the handler, or nothing to leave the terminal alone.
   */
  setCancelHandler(handler: (() => void) | undefined): void {
    this.terminal.setCancelHandler(handler);
  }

  /**
   * Disposes of the output.
   */
  dispose(): void {
    this.terminal.dispose();
    this.channel.dispose();
  }

  /**
   * Where the output goes.
   */
  private sink(): TestOutput | ChannelOutput {
    return runInTerminal() ? this.terminal : this.channel;
  }
}

export const testOutput = new TestOutputFacade();
