import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '../config';
import { TestNode } from '../testNode';
import { TestResult } from '../testResult';
import { Uri } from './mocks/vscode';

describe('Config', () => {
  it('skips the conventional vendor and editor directories', () => {
    expect(Config.SkipFolders).toContain('vendor');
    expect(Config.SkipFolders).toContain('.git');
    expect(Config.SkipFolders).toContain('.vscode');
  });

  it('caps the number of parallel test runs', () => {
    expect(Config.RunMaxParallelTest).toBeGreaterThan(0);
  });
});

describe('TestNode', () => {
  const uri = Uri.file('/repo/alpha_test.go');

  it('is a suite when it has children', () => {
    const node = new TestNode('alpha_test.go', uri, [new TestNode('TestAlpha', uri)]);
    expect(node.isTestSuite).toBe(true);
  });

  it('is not a suite when it has no children', () => {
    const node = new TestNode('TestAlpha', uri);
    expect(node.isTestSuite).toBe(false);
    expect(node.children).toEqual([]);
  });

  it('reports the loading icon while running', () => {
    const node = new TestNode('TestAlpha', uri);
    node.setLoading();
    expect(node.isLoading).toBe(true);
    expect(node.icon).toBe('spinner.svg');
  });

  it('clears the loading state when a result arrives', () => {
    const node = new TestNode('TestAlpha', uri);
    node.setLoading();
    node.testResult = new TestResult(uri, 'TestAlpha', true, []);
    expect(node.isLoading).toBe(false);
    expect(node.icon).toBe('testPassed.svg');
  });

  it('shows a failed icon for a failed test', () => {
    const node = new TestNode('TestAlpha', uri);
    node.testResult = new TestResult(uri, 'TestAlpha', false, []);
    expect(node.icon).toBe('testFailed.svg');
  });

  it('shows a pending icon for a test that has not run', () => {
    const node = new TestNode('TestAlpha', uri);
    expect(node.icon).toBe('test.svg');
  });

  it('marks a suite failed when any child failed', () => {
    const passed = new TestNode('TestAlpha', uri);
    passed.testResult = new TestResult(uri, 'TestAlpha', true, []);
    const failed = new TestNode('TestBeta', uri);
    failed.testResult = new TestResult(uri, 'TestBeta', false, []);

    const suite = new TestNode('alpha_test.go', uri, [passed, failed]);
    expect(suite.icon).toBe('testSuiteFailed.svg');
  });

  it('marks a suite passed when every child passed', () => {
    const passed = new TestNode('TestAlpha', uri);
    passed.testResult = new TestResult(uri, 'TestAlpha', true, []);
    const suite = new TestNode('alpha_test.go', uri, [passed]);
    expect(suite.icon).toBe('testSuitePassed.svg');
  });
});

describe('extension activation', () => {
  beforeEach(() => {
    // The placeholder test asserted `-1 === [1,2,3].indexOf(5)`. It proved
    // nothing about the extension, so it is replaced by real coverage.
  });

  it('exposes the commands the package manifest contributes', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    );
    const contributed = manifest.contributes.commands.map((c: { command: string }) => c.command);
    expect(contributed).toContain('goTestExplorer.runTest');
    expect(contributed).toContain('goTestExplorer.runAllTest');
    expect(contributed).toContain('goTestExplorer.refreshTestExplorer');
    expect(contributed).toContain('goTestExplorer.runTestSuite');
    expect(contributed).toContain('goTestExplorer.showTestoutput');
    expect(contributed).toContain('goTestExplorer.goToLocation');
    expect(contributed).toContain('goTestExplorer.filterTests');
    expect(contributed).toContain('goTestExplorer.expandAll');
    expect(contributed).toContain('goTestExplorer.showCoverage');
    expect(contributed).toContain('goTestExplorer.hideCoverage');
    expect(contributed).toContain('goTestExplorer.collapseAll');
    expect(contributed).toContain('goTestExplorer.clearFilter');
  });
});
