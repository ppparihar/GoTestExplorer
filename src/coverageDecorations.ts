import * as vscode from 'vscode';
import { CoverBlock, coveragePercent, markedLines } from './lib/coverageProfile';

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
  private enabled = false;
  /**
   * What the tests covered, keyed by the path of the file.
   */
  private readonly files = new Map<string, CoverBlock[]>();

  constructor() {
    // An editor that is opened after the run is marked when it appears.
    this.subscription = vscode.window.onDidChangeVisibleTextEditors(() => this.render());
    // A click on the percentage opens the report of the files.
    this.statusItem.command = 'goTestExplorer.showCoverageReport';
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
   * Takes what a run covered. A file the run covered replaces what was known
   * of it, and the files it did not cover keep what they had.
   */
  update(covered: ReadonlyMap<string, CoverBlock[]>): void {
    covered.forEach((blocks, file) => this.files.set(file, blocks));
    this.render();
  }

  /**
   * Removes every mark.
   */
  clear(): void {
    this.files.clear();
    this.render();
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

  private render(): void {
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
    this.statusItem.text =
      percent === undefined
        ? '$(shield) Coverage: run tests to see it'
        : `$(shield) Coverage ${percent.toFixed(1)}%`;
    this.statusItem.tooltip =
      'Code coverage of the last test runs. Green lines ran, red lines did not. Click for the files.';
    this.statusItem.show();
  }

  dispose(): void {
    this.subscription.dispose();
    this.coveredType.dispose();
    this.uncoveredType.dispose();
    this.statusItem.dispose();
  }
}
