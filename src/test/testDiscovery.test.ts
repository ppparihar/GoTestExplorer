import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestDiscovery } from '../testDiscovery';
import { TestNode } from '../testNode';
import { Commands } from '../commands';
import { __state, __reset, Uri } from './mocks/vscode';

const getTestFunctions = vi.fn();
const isToolAvailable = vi.fn();

vi.mock('../lib/testUtil', async importOriginal => {
	const actual = await importOriginal<typeof import('../lib/testUtil')>();
	return {
		...actual,
		getTestFunctions: (...args: unknown[]) => getTestFunctions(...args),
		isToolAvailable: (...args: unknown[]) => isToolAvailable(...args)
	};
});

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

function writeTestFile(dir: string, name: string): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, 'package x\n\nfunc TestAlpha(t *testing.T) {}\n');
	return file;
}

function fakeCommands(): FakeCommands {
	return new FakeCommands();
}

beforeEach(() => {
	__reset();
	getTestFunctions.mockReset();
	isToolAvailable.mockReset();
	isToolAvailable.mockReturnValue(true);
	getTestFunctions.mockResolvedValue([
		{ name: 'TestAlpha', kind: 11, location: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
	]);
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

	it('reports a missing go-outline once, with an actionable message', async () => {
		const folder = makeTempDir();
		writeTestFile(folder, 'alpha_test.go');
		writeTestFile(folder, 'beta_test.go');
		writeTestFile(folder, 'gamma_test.go');
		__state.workspaceFolders = [{ uri: Uri.file(folder), name: 'a', index: 0 }];

		isToolAvailable.mockReturnValue(false);

		const commands = fakeCommands();
		new TestDiscovery(commands as unknown as Commands).discoverAllTests();

		await waitFor(() => commands.discovered.length > 0);

		// One message for the whole refresh, not one per file.
		expect(__state.messages.error.length).toBe(1);
		expect(__state.messages.error[0]).toContain('go-outline');
		expect(__state.messages.error[0]).toContain('go install');
		expect(commands.discovered[0]).toEqual([]);
		expect(getTestFunctions).not.toHaveBeenCalled();
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
