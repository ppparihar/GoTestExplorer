import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestDiscovery } from '../testDiscovery';
import { TestNode } from '../testNode';
import { Commands } from '../commands';
import { __state, __reset, Uri } from './mocks/vscode';

class FakeCommands {
	discoveryStarted = 0;
	discovered: TestNode[][] = [];

	sendTestDiscoveryStarted(): void {
		this.discoveryStarted++;
	}

	sendDiscoveredTests(nodes: TestNode[]): void {
		this.discovered.push(nodes);
	}
}

let tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-'));
	tempDirs.push(dir);
	return dir;
}

function writeTestFile(dir: string, name: string, body: string = 'func TestAlpha(t *testing.T) {}'): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, `package x\n\n${body}\n`);
	return file;
}

function fakeCommands(): FakeCommands {
	return new FakeCommands();
}

beforeEach(() => {
	__reset();
});

afterEach(() => {
	tempDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
	tempDirs = [];
});

describe('TestDiscovery.discoverAllTests', () => {
	it('discovers tests in every workspace folder', async () => {
		const folderA = makeTempDir();
		const folderB = makeTempDir();
		writeTestFile(folderA, 'alpha_test.go');
		writeTestFile(folderB, 'beta_test.go');

		__state.workspaceFolders = [
			{ uri: Uri.file(folderA), name: 'a', index: 0 },
			{ uri: Uri.file(folderB), name: 'b', index: 1 }
		];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);

		expect(commands.discoveryStarted).toBe(1);
		const nodes = commands.discovered[0];
		const fileNames = nodes.map(n => n.name).sort();
		expect(fileNames).toEqual(['alpha_test.go', 'beta_test.go']);
	});

	it('does not scan the same folder twice', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go');
		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);
		expect(commands.discovered[0].length).toBe(1);
	});

	it('sends an empty result when there are no workspace folders', () => {
		__state.workspaceFolders = [];
		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		expect(commands.discovered.length).toBe(1);
		expect(commands.discovered[0]).toEqual([]);
	});

	it('ignores folders that are not on the file system', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go');
		__state.workspaceFolders = [
			{ uri: Uri.parse('untitled:workspace-1'), name: 'virtual', index: 0 },
			{ uri: Uri.file(folder), name: 'a', index: 1 }
		];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);
		expect(commands.discovered[0].map(n => n.name)).toEqual(['alpha_test.go']);
	});

	it('discovers the test names in a file', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go', [
			'func TestAlpha(t *testing.T) {}',
			'func TestBeta(t *testing.T) {}'
		].join('\n'));
		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);

		const suite = commands.discovered[0][0];
		expect(suite.name).toBe('alpha_test.go');
		expect(suite.children.map(c => c.name)).toEqual(['TestAlpha', 'TestBeta']);
	});

	it('discovers tests without any external tool installed', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go');
		writeTestFile(folder, 'beta_test.go');
		writeTestFile(folder, 'gamma_test.go');
		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);

		// Discovery is entirely in-process, so it neither needs a Go
		// toolchain nor complains about a missing one.
		expect(__state.messages.error).toEqual([]);
		expect(commands.discovered[0].length).toBe(3);
	});

	it('ignores files that are not Go test files', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go');
		writeTestFile(folder, 'helper.go');
		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);
		expect(commands.discovered[0].map(n => n.name)).toEqual(['alpha_test.go']);
	});

	it('reports a file it could not scan with confidence', async () => {
		const folder = makeTempDir();
		// An unterminated string is not valid Go, so the file cannot be
		// scanned with confidence and may hold tests the scan missed.
		writeTestFile(folder, 'broken_test.go', 'const s = "unterminated');
		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

		try {
			const commands = fakeCommands();
			new TestDiscovery(commands as unknown as Commands).discoverAllTests();

			await waitFor(() => commands.discovered.length > 0);

			expect(commands.discovered[0].map(n => n.name)).toEqual(['broken_test.go']);
			expect(warn).toHaveBeenCalled();
			expect(warn.mock.calls[0][0]).toContain('broken_test.go');
			expect(warn.mock.calls[0][0]).toContain('unterminated string literal');
		} finally {
			warn.mockRestore();
		}
	});
});

describe('TestDiscovery workspace path resolution', () => {
	it('resolves the workspace folder through fsPath, not path', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go');

		// Simulates Windows, where `uri.path` is `/c:/repo` but `uri.fsPath`
		// is the real path on disk. Using `path` finds nothing there.
		const uri = Uri.__fileWithDifferentFsPath('/c:/repo', folder);
		__state.workspaceFolders = [{ uri, name: 'a', index: 0 }];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);

		const nodes = commands.discovered[0];
		expect(nodes.length).toBe(1);
		expect(nodes[0].uri.fsPath).toBe(path.join(folder, 'alpha_test.go'));
	});

	it('scans the src directory of a folder when it exists', async () => {
		const folder = makeTempDir();
		const src = path.join(folder, 'src');
		fs.mkdirSync(src);
		writeTestFile(src, 'alpha_test.go');
		writeTestFile(folder, 'root_test.go');

		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);
		expect(commands.discovered[0].map(n => n.name)).toEqual(['alpha_test.go']);
	});
});

async function waitFor(predicate: () => boolean, timeoutMs: number = 5000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('timed out waiting for condition');
		}
		await new Promise(r => setTimeout(r, 5));
	}
}
