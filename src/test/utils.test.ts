import { describe, it, expect, beforeEach } from 'vitest';
import { getToolsEnvVars, getTestEnvVars, getCurrentGoPath, promptForMissingTool, resetMissingToolWarnings } from '../lib/utils';
import { __configCalls, __reset, __setConfiguration, __state, Uri } from './mocks/vscode';

const activeUri = Uri.file('/repo/active.go');
const testUri = Uri.file('/repo/pkg/alpha_test.go');

beforeEach(() => {
	__reset();
	resetMissingToolWarnings();
	__state.activeTextEditor = { document: { uri: activeUri } };
	__setConfiguration('go', (resource?: Uri) => {
		if (resource && resource.fsPath === testUri.fsPath) {
			return {
				toolsEnvVars: { FROM_TEST_FILE: 'test-file-value' },
				gopath: '/gopath/from-test-file'
			};
		}
		return {
			toolsEnvVars: { FROM_ACTIVE_EDITOR: 'active-value' },
			gopath: '/gopath/from-active-editor'
		};
	});
});

describe('getToolsEnvVars', () => {
	it('resolves settings against the given resource', () => {
		const env = getToolsEnvVars(testUri);
		expect(env.FROM_TEST_FILE).toBe('test-file-value');
	});

	it('does not use the focused editor when a resource is given', () => {
		const env = getToolsEnvVars(testUri);
		expect(env.FROM_ACTIVE_EDITOR).toBeUndefined();
	});

	it('falls back to the focused editor when no resource is given', () => {
		const env = getToolsEnvVars();
		expect(env.FROM_ACTIVE_EDITOR).toBe('active-value');
	});

	it('asks for the configuration of the resource it was given', () => {
		getToolsEnvVars(testUri);
		const goCalls = __configCalls.calls.filter(c => c.section === 'go');
		expect(goCalls.some(c => c.resource && c.resource.fsPath === testUri.fsPath)).toBe(true);
	});

	it('always includes the ambient environment', () => {
		const env = getToolsEnvVars(testUri);
		expect(env.PATH).toBe(process.env.PATH);
	});
});

describe('getCurrentGoPath', () => {
	it('resolves the gopath against the given resource', () => {
		expect(getCurrentGoPath(testUri)).toBe('/gopath/from-test-file');
	});

	it('falls back to the ambient GOPATH when nothing is configured', () => {
		__setConfiguration('go', {});
		const expected = process.env['GOPATH'];
		expect(getCurrentGoPath(testUri)).toBe(expected);
	});
});

describe('promptForMissingTool', () => {
	it('reports a missing tool once, not once per file', () => {
		promptForMissingTool('go-outline');
		promptForMissingTool('go-outline');
		promptForMissingTool('go-outline');

		expect(__state.messages.info.length).toBe(1);
		expect(__state.messages.info[0]).toContain('go-outline');
	});

	it('reports each missing tool separately', () => {
		promptForMissingTool('go-outline');
		promptForMissingTool('gopls');

		expect(__state.messages.info.length).toBe(2);
	});
});

describe('getTestEnvVars', () => {
	it('layers the test environment on top of the tool environment', () => {
		const config = {
			get: (): any => undefined,
			has: () => false,
			inspect: (): Record<string, unknown> => ({}),
			testEnvVars: { EXTRA: 'extra-value' }
		};
		const env = getTestEnvVars(config as never, testUri);
		expect(env.EXTRA).toBe('extra-value');
		expect(env.FROM_TEST_FILE).toBe('test-file-value');
	});

	it('does not pick up the focused editor environment', () => {
		const config = {
			get: (): any => undefined,
			has: () => false,
			inspect: (): Record<string, unknown> => ({}),
			testEnvVars: {}
		};
		const env = getTestEnvVars(config as never, testUri);
		expect(env.FROM_ACTIVE_EDITOR).toBeUndefined();
	});
});
