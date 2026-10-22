/**
 * A minimal but functional stand-in for the `vscode` module.
 *
 * The extension host is not available in unit tests, so modules that import
 * `vscode` are pointed at this mock (see `vitest.config.ts` and
 * `bench/vscode-shim.ts`). Only the surface the extension actually uses is
 * implemented; anything else throws loudly rather than silently returning
 * `undefined`.
 */

export enum SymbolKind {
	File = 0, Module = 1, Namespace = 2, Package = 3, Class = 4,
	Method = 5, Property = 6, Field = 7, Constructor = 8, Enum = 9,
	Interface = 10, Function = 11, Variable = 12, Constant = 13,
	String = 14, Number = 15, Boolean = 16, Array = 17, Object = 18,
	Key = 19, Null = 20, EnumMember = 21, Struct = 22, Event = 23,
	Operator = 24, TypeParameter = 25
}

export enum FileType {
	Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64
}

export enum TreeItemCollapsibleState {
	None = 0, Collapsed = 1, Expanded = 2
}

export enum TextEditorRevealType {
	Default = 0, InCenter = 1, InCenterIfOutsideViewport = 2, AtTop = 3
}

export enum FileChangeType { Changed = 1, Created = 2, Deleted = 3 }

export class Position {
	constructor(public readonly line: number, public readonly character: number) { }
}

export class Range {
	constructor(public readonly start: Position, public readonly end: Position) { }
}

export class Selection extends Range {
	constructor(start: Position, end: Position) {
		super(start, end);
	}
}

export class Uri {
	private constructor(
		public readonly scheme: string,
		public readonly authority: string,
		public readonly path: string,
		public readonly query: string,
		public readonly fragment: string,
		private readonly fsPathOverride?: string) { }

	static file(fsPath: string): Uri {
		const normalised = fsPath.replace(/\\/g, '/');
		const withLeadingSlash = normalised.startsWith('/') ? normalised : '/' + normalised;
		return new Uri('file', '', withLeadingSlash, '', '');
	}

	/**
	 * Builds a URI whose `path` differs from its `fsPath`, the way it does on
	 * Windows (`/c:/repo` against `c:\repo`). Lets a test prove that code
	 * reads `fsPath` rather than `path`.
	 */
	static __fileWithDifferentFsPath(pathValue: string, fsPath: string): Uri {
		return new Uri('file', '', pathValue, '', '', fsPath);
	}

	static parse(value: string): Uri {
		const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
		if (!match) {
			return Uri.file(value);
		}
		return new Uri(match[1], match[2] || '', match[3] || '', match[4] || '', match[5] || '');
	}

	get fsPath(): string {
		return this.fsPathOverride ?? this.path;
	}

	with(change: { path?: string; scheme?: string }): Uri {
		return new Uri(
			change.scheme ?? this.scheme,
			this.authority,
			change.path ?? this.path,
			this.query,
			this.fragment);
	}

	toString(): string {
		return `${this.scheme}://${this.authority}${this.path}`;
	}

	toJSON(): any {
		return {
			$mid: 1,
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
			fsPath: this.fsPath,
			external: this.toString()
		};
	}
}

export class Disposable {
	constructor(private readonly callOnDispose: () => void = () => { }) { }
	dispose(): void {
		this.callOnDispose();
	}
	static from(...items: { dispose(): unknown }[]): Disposable {
		return new Disposable(() => items.forEach(i => i.dispose()));
	}
}

export class EventEmitter<T> {
	private listeners: ((e: T) => unknown)[] = [];

	readonly event = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]): Disposable => {
		// The real `Event` honours `thisArgs`, which `Commands` relies on when
		// it passes a bound method together with its receiver.
		const bound = thisArgs ? (data: T) => listener.call(thisArgs, data) : listener;
		this.listeners.push(bound);
		const disposable = new Disposable(() => {
			this.listeners = this.listeners.filter(l => l !== bound);
		});
		if (disposables) {
			disposables.push(disposable);
		}
		return disposable;
	};

	fire(data: T): void {
		// Copy so a listener that unsubscribes during dispatch cannot skip others.
		for (const listener of this.listeners.slice()) {
			listener(data);
		}
	}

	dispose(): void {
		this.listeners = [];
	}
}

export class TreeItem {
	contextValue?: string;
	command?: unknown;
	iconPath?: unknown;
	constructor(public label: string, public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) { }
}

export class SymbolInformation {
	constructor(
		public name: string,
		public kind: SymbolKind,
		public location: Range,
		public containerName?: string,
		public uri?: Uri) { }
}

export interface WorkspaceFolder {
	uri: Uri;
	name: string;
	index: number;
}

/**
 * A configuration object backed by a plain record, supporting both the
 * `get`/`has`/`inspect` API and index access (`config['someKey']`).
 */
export class WorkspaceConfiguration {
	private readonly values: Record<string, unknown>;
	private readonly inspectFn?: (key: string) => Record<string, unknown>;

	constructor(
		values: Record<string, unknown>,
		inspectFn?: (key: string) => Record<string, unknown>) {
		this.values = values;
		this.inspectFn = inspectFn;

		// Index access (`config['toolsGopath']`) is how the extension reads
		// most settings, so the proxy forwards unknown keys to the backing
		// record instead of returning `undefined`.
		return new Proxy(this, {
			get(target, property, receiver) {
				if (property in target) {
					return Reflect.get(target, property, receiver);
				}
				return target.values[property as string];
			},
			has(target, property) {
				return property in target || property in target.values;
			}
		});
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.values[key];
		return (value === undefined ? defaultValue : value) as T | undefined;
	}

	has(key: string): boolean {
		return this.values[key] !== undefined;
	}

	update(key: string, value: unknown): Promise<void> {
		this.values[key] = value;
		return Promise.resolve();
	}

	inspect<T>(key: string): {
		key: string;
		defaultValue?: T;
		globalValue?: T;
		workspaceValue?: T;
		workspaceFolderValue?: T;
		defaultLanguageValue?: T;
		globalLanguageValue?: T;
		workspaceLanguageValue?: T;
		workspaceFolderLanguageValue?: T;
		languageIds?: string[];
	} {
		const inspected = this.inspectFn ? this.inspectFn(key) : {};
		return { key, ...inspected } as unknown as {
			key: string;
			defaultValue?: T;
			globalValue?: T;
			workspaceValue?: T;
			workspaceFolderValue?: T;
			defaultLanguageValue?: T;
			globalLanguageValue?: T;
			workspaceLanguageValue?: T;
			workspaceFolderLanguageValue?: T;
			languageIds?: string[];
		};
	}

	[key: string]: unknown;
}

/**
 * Records every `getConfiguration` call so tests can assert which resource a
 * configuration was resolved against.
 */
export class ConfigurationCallLog {
	readonly calls: { section: string; resource: Uri | undefined }[] = [];
	reset(): void {
		this.calls.length = 0;
	}
}

export const __configCalls = new ConfigurationCallLog();

/**
 * A stand-in for a text editor.
 */
export interface MockTextEditor {
	document: { uri: Uri };
	selection: Selection;
	revealRange(range: Range, type?: TextEditorRevealType): void;
}

export const __state = {
	workspaceFolders: undefined as WorkspaceFolder[] | undefined,
	rootPath: undefined as string | undefined,
	activeTextEditor: undefined as MockTextEditor | undefined,
	configurationValues: {} as Record<string, Record<string, unknown> | ((resource?: Uri) => Record<string, unknown>)>,
	messages: {
		info: [] as string[],
		warning: [] as string[],
		error: [] as string[]
	},
	registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
	openedDocuments: [] as Uri[],
	/**
	 * The contents of the documents the mock hands out, keyed by path.
	 */
	documentTexts: new Map<string, string>(),
	/**
	 * The file watchers the code under test has created.
	 */
	fileWatchers: [] as MockFileSystemWatcher[],
	/**
	 * The output channels the code under test has created.
	 */
	outputChannels: [] as { name: string; lines: string[]; }[]
};

/**
 * A stand-in for a file system watcher.
 *
 * The real watcher reports a change to a file when it is written on disk.
 * A test drives this one with `__fireFileWatchEvent`.
 */
export class MockFileSystemWatcher {
	private readonly createEmitter = new EventEmitter<Uri>();
	private readonly changeEmitter = new EventEmitter<Uri>();
	private readonly deleteEmitter = new EventEmitter<Uri>();

	constructor(public readonly glob: string = '') { }

	get onDidCreate(): (listener: (uri: Uri) => unknown) => Disposable {
		return this.createEmitter.event;
	}
	get onDidChange(): (listener: (uri: Uri) => unknown) => Disposable {
		return this.changeEmitter.event;
	}
	get onDidDelete(): (listener: (uri: Uri) => unknown) => Disposable {
		return this.deleteEmitter.event;
	}

	fireCreate(uri: Uri): void {
		this.createEmitter.fire(uri);
	}
	fireChange(uri: Uri): void {
		this.changeEmitter.fire(uri);
	}
	fireDelete(uri: Uri): void {
		this.deleteEmitter.fire(uri);
	}

	dispose(): void {
		this.createEmitter.dispose();
		this.changeEmitter.dispose();
		this.deleteEmitter.dispose();
	}
}

/**
 * Reports a change to a file to every watcher that was created.
 */
export function __fireFileWatchEvent(kind: 'create' | 'change' | 'delete', filePath: string): void {
	const uri = Uri.file(filePath);
	__state.fileWatchers.forEach(watcher => {
		if (kind === 'create') {
			watcher.fireCreate(uri);
		} else if (kind === 'change') {
			watcher.fireChange(uri);
		} else {
			watcher.fireDelete(uri);
		}
	});
}

/**
 * Resets all recorded state between tests.
 */
export function __reset(): void {
	__state.workspaceFolders = undefined;
	__state.rootPath = undefined;
	__state.activeTextEditor = undefined;
	__state.configurationValues = {};
	__state.messages.info = [];
	__state.messages.warning = [];
	__state.messages.error = [];
	__state.registeredCommands.clear();
	__state.openedDocuments = [];
	__state.documentTexts.clear();
	__state.fileWatchers = [];
	__configCalls.reset();
}

/**
 * Sets the text the mock returns for a document.
 */
export function __setDocumentText(path: string, text: string): void {
	__state.documentTexts.set(path, text);
}

/**
 * Registers the values returned for `getConfiguration(section, resource)`.
 *
 * The value may be a plain record, or a function of the resource, so a test
 * can give different settings to different files.
 */
export function __setConfiguration(section: string, values: Record<string, unknown> | ((resource?: Uri) => Record<string, unknown>)): void {
	__state.configurationValues[section] = values;
}

export const workspace = {
	get workspaceFolders(): WorkspaceFolder[] | undefined {
		return __state.workspaceFolders;
	},
	get rootPath(): string | undefined {
		return __state.rootPath;
	},
	getConfiguration(section: string, resource?: Uri): WorkspaceConfiguration {
		__configCalls.calls.push({ section, resource });
		const raw = __state.configurationValues[section] ?? {};
		const values = typeof raw === 'function' ? raw(resource) : raw;
		return new WorkspaceConfiguration(values);
	},
	openTextDocument(uri: Uri): Promise<{ getText(): string; uri: Uri; fileName: string; positionAt(o: number): Position }> {
		__state.openedDocuments.push(uri);
		return Promise.resolve({
			getText: () => __state.documentTexts.get(uri.fsPath) ?? '',
			uri,
			fileName: uri.fsPath,
			positionAt: (offset: number) => new Position(0, offset)
		});
	},
	createFileSystemWatcher(glob?: string): MockFileSystemWatcher {
		const watcher = new MockFileSystemWatcher(glob);
		__state.fileWatchers.push(watcher);
		return watcher;
	},
	asRelativePath(p: string): string {
		return p;
	}
};

export const window = {
	get activeTextEditor(): MockTextEditor | undefined {
		return __state.activeTextEditor;
	},
	showInformationMessage(message: string): Promise<undefined> {
		__state.messages.info.push(message);
		return Promise.resolve(undefined);
	},
	showWarningMessage(message: string): Promise<undefined> {
		__state.messages.warning.push(message);
		return Promise.resolve(undefined);
	},
	showErrorMessage(message: string): Promise<undefined> {
		__state.messages.error.push(message);
		return Promise.resolve(undefined);
	},
	createOutputChannel(name: string) {
		const lines: string[] = [];
		__state.outputChannels.push({ name, lines });
		return {
			appendLine(line: string): void { lines.push(line); },
			append(text: string): void { lines.push(text); },
			clear(): void { lines.length = 0; },
			show(): void { },
			hide(): void { },
			dispose(): void { },
			lines
		};
	},
	registerTreeDataProvider(_id: string, _provider: unknown): Disposable {
		return new Disposable();
	},
	showTextDocument(): Promise<unknown> {
		return Promise.resolve({});
	}
};

export const commands = {
	registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable {
		__state.registeredCommands.set(command, callback);
		return new Disposable();
	},
	executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
		const cb = __state.registeredCommands.get(command);
		return Promise.resolve(cb ? cb(...args) : undefined);
	}
};

export const env = {
	machineId: 'test-machine',
	openExternal(): Promise<boolean> {
		return Promise.resolve(true);
	}
};

export default {
	SymbolKind, FileType, TreeItemCollapsibleState, TextEditorRevealType, FileChangeType,
	Position, Range, Selection, Uri, Disposable, EventEmitter, TreeItem, SymbolInformation,
	WorkspaceConfiguration, MockFileSystemWatcher, workspace, window, commands, env
};
