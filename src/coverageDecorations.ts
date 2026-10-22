import * as vscode from 'vscode';
import * as path from 'path';
import { addCoverage, CoverBlock, coveragePercent, markedLines } from './lib/coverageProfile';

/**
 * Marks the lines that the tests ran, and the lines they did not, in the open
 * editors, and shows the share of the statements that ran in the status bar.
 *
 * The lines are marked with a background and a mark in the overview ruler
 * rather than with a glyph in the gutter, so they never compete with the
 * breakpoints for the same place.
 */
export class CoverageDecorations implements vscode.Disposable {
  private readonly coveredType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(63, 185, 80, 0.15)',
    overviewRulerColor: 'rgba(63, 185, 80, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private readonly uncoveredType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(248, 81, 73, 0.18)',
    overviewRulerColor: 'rgba(248, 81, 73, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private readonly statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0,
  );
  private readonly subscription: vscode.Disposable;
  private readonly saveSubscription: vscode.Disposable;
  private enabled = false;
  private _complete = false;
  private busy = false;
  private readonly changed = new vscode.EventEmitter<void>();
  /**
   * What is known about the coverage changed.
   */
  readonly onDidChange = this.changed.event;
  /**
   * What the tests covered, keyed by the path of the file.
   */
  private readonly files = new Map<string, CoverBlock[]>();

  constructor() {
    // An editor that is opened after the run is marked when it appears.
    this.subscription = vscode.window.onDidChangeVisibleTextEditors(() => this.render());
    // A click on the percentage opens the report of the files.
    this.statusItem.command = 'goTestExplorer.showCoverageReport';
    this.saveSubscription = vscode.workspace.onDidSaveTextDocument((document) =>
      this.forget(document.uri.fsPath),
    );
  }

  /**
   * Tells whether coverage is on. While it is on the status bar shows it, even
   * before a run has measured anything, so it is clear what to do next.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.render();
  }

  /**
   * Tells whether tests are running, so that the figure can show that it is
   * about to change.
   */
  setBusy(busy: boolean): void {
    if (this.busy !== busy) {
      this.busy = busy;
      this.render();
    }
  }

  /**
   * The coverage of each file that is known, the least covered file first.
   */
  report(): Array<{ file: string; percent: number; ran: number; total: number }> {
    return Array.from(this.files, ([file, blocks]) => ({
      file,
      percent: coveragePercent(blocks),
      ran: blocks.reduce((sum, block) => sum + (block.count > 0 ? block.statements : 0), 0),
      total: blocks.reduce((sum, block) => sum + block.statements, 0),
    })).sort((a, b) => a.percent - b.percent || a.file.localeCompare(b.file));
  }

  /**
   * Takes what a run covered.
   *
   * A run of a whole module replaces what was known of the files it covered.
   * A run of part of a package adds to it, so that it never takes back what
   * other runs covered. A package of a run of a whole module that has just
   * finished replaces the files it covered too, but the run is not complete
   * until it has ended, so it does not make the figure complete.
   */
  update(covered: ReadonlyMap<string, CoverBlock[]>, mode: 'replace' | 'add' | 'stream'): void {
    if (mode === 'replace') {
      this._complete = true;
    }
    covered.forEach((blocks, file) => {
      const known = this.files.get(file);
      this.files.set(file, mode === 'add' && known ? addCoverage(known, blocks) : blocks);
    });
    this.render();
  }

  /**
   * Forgets what is known of a file, because it has been edited since the
   * tests ran and the marks would no longer be where the code is.
   */
  forget(file: string): void {
    if (this.files.delete(file)) {
      this._complete = false;
      this.render();
    }
  }

  /**
   * Removes every mark.
   */
  clear(): void {
    this.files.clear();
    this._complete = false;
    this.render();
  }

  /**
   * Whether the figure comes from a run of every test, and still holds. Until
   * then it is the share of the files that were run, not of the project.
   */
  get complete(): boolean {
    return this._complete;
  }

  /**
   * The share of the statements that ran, across every file that is known,
   * or undefined when nothing is known.
   */
  get percent(): number | undefined {
    if (this.files.size === 0) {
      return undefined;
    }
    return coveragePercent(Array.from(this.files.values()).flat());
  }

  /**
   * The share of the statements of one file that ran, or undefined when the
   * file was not covered.
   */
  percentOfFile(file: string): number | undefined {
    const blocks = this.files.get(file);
    return blocks ? coveragePercent(blocks) : undefined;
  }

  /**
   * The share of the statements of the files of one directory that ran, or
   * undefined when none of them was covered.
   */
  percentOfDirectory(dir: string): number | undefined {
    const blocks: CoverBlock[] = [];
    this.files.forEach((fileBlocks, file) => {
      if (path.dirname(file) === dir) {
        blocks.push(...fileBlocks);
      }
    });
    return blocks.length > 0 ? coveragePercent(blocks) : undefined;
  }

  private render(): void {
    this.changed.fire();
    for (const editor of vscode.window.visibleTextEditors) {
      const blocks = this.files.get(editor.document.uri.fsPath);
      const lines = blocks ? markedLines(blocks) : { covered: [], uncovered: [] };
      const range = (line: number) =>
        new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
      editor.setDecorations(this.coveredType, lines.covered.map(range));
      editor.setDecorations(this.uncoveredType, lines.uncovered.map(range));
    }
    const percent = this.percent;
    if (!this.enabled) {
      this.statusItem.hide();
      return;
    }
    // The icon of the status bar spins while tests are running.
    const icon = this.busy ? '$(sync~spin)' : '$(shield)';
    this.statusItem.text =
      percent === undefined
        ? `${icon} Coverage: ${this.busy ? 'running tests' : 'run tests to see it'}`
        : `${icon} Coverage ${percent.toFixed(1)}%${this._complete ? '' : ' (partial)'}`;
    this.statusItem.tooltip =
      'Code coverage of the last test runs. Green lines ran, red lines did not. "Partial" means Run All has not covered every file yet. Click for the files.';
    this.statusItem.show();
  }

  dispose(): void {
    this.subscription.dispose();
    this.saveSubscription.dispose();
    this.coveredType.dispose();
    this.uncoveredType.dispose();
    this.statusItem.dispose();
    this.changed.dispose();
  }
}
