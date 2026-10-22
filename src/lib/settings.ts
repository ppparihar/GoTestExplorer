import * as vscode from 'vscode';
import { Config } from '../config';
import { resolveTestTimeout } from './testArgs';

/**
 * The section of the settings that belong to this extension.
 */
const ownSection = 'goTestExplorer';

/**
 * The section of the settings that belong to the Go extension.
 */
const goSection = 'go';

/**
 * The value the user set for a setting.
 *
 * The default of a setting is not a value the user set, so it is not
 * returned: the setting of the Go extension is used instead, and the default
 * of this extension is the last resort. The most specific scope wins, so a
 * setting made for one folder beats one made for the whole workspace.
 */
export function userSetValue<T>(
  inspected:
    | {
        defaultValue?: T;
        globalValue?: T;
        workspaceValue?: T;
        workspaceFolderValue?: T;
      }
    | undefined,
): T | undefined {
  if (!inspected) {
    return undefined;
  }
  if (inspected.workspaceFolderValue !== undefined) {
    return inspected.workspaceFolderValue;
  }
  if (inspected.workspaceValue !== undefined) {
    return inspected.workspaceValue;
  }
  if (inspected.globalValue !== undefined) {
    return inspected.globalValue;
  }
  return undefined;
}

/**
 * Reads a setting of this extension, falling back to the setting of the Go
 * extension.
 *
 * The value the user set for this extension wins, whatever scope it is in.
 * When the user has not set it, the value of the Go extension is used, so
 * that a user who already configures the Go extension does not have to
 * configure the same thing twice. The default of this extension is the last
 * resort.
 *
 * @param key the name of the setting of this extension.
 * @param goKey the name of the setting of the Go extension, if there is one.
 * @param defaultValue the value to use when neither extension has a value.
 * @param resource the file the settings are resolved against.
 */
export function readSetting<T>(
  key: string,
  goKey: string | undefined,
  defaultValue: T,
  resource?: vscode.Uri,
): T {
  const own = vscode.workspace.getConfiguration(ownSection, resource);
  const ownValue = userSetValue(own.inspect<T>(key));
  if (ownValue !== undefined) {
    return ownValue;
  }
  if (goKey !== undefined) {
    const goValue = vscode.workspace.getConfiguration(goSection, resource).get<T>(goKey);
    if (goValue !== undefined) {
      return goValue;
    }
  }
  return defaultValue;
}

/**
 * The number of test runs that are allowed to be in flight at the same time.
 */
export function maxParallelTests(resource?: vscode.Uri): number {
  const value = readSetting<number>(
    'maxParallelTests',
    undefined,
    Config.RunMaxParallelTest,
    resource,
  );
  if (typeof value !== 'number' || !isFinite(value) || value < 1) {
    return Config.RunMaxParallelTest;
  }
  return Math.floor(value);
}

/**
 * The names of the folders that are never walked while looking for test files.
 */
export function skipFolders(resource?: vscode.Uri): string[] {
  const value = readSetting<string[]>('skipFolders', undefined, Config.SkipFolders, resource);
  if (!Array.isArray(value)) {
    return Config.SkipFolders;
  }
  const names = value.filter((name) => typeof name === 'string' && name.trim() !== '');
  return names.length > 0 ? names : Config.SkipFolders;
}

/**
 * The GOPATH to use.
 *
 * The GOPATH of the Go extension is used when the user has not set one here.
 */
export function goPath(resource?: vscode.Uri): string {
  const value = readSetting<string>('goPath', 'gopath', Config.DefaultGoPath, resource);
  return typeof value === 'string' ? value : Config.DefaultGoPath;
}

/**
 * The go binary the user named.
 *
 * When this is empty the binary is looked up, so this setting only has to be
 * set when the binary is not where the lookup finds it.
 */
export function goBinary(resource?: vscode.Uri): string {
  const value = readSetting<string>('goBinary', undefined, Config.DefaultGoBinary, resource);
  return typeof value === 'string' ? value : Config.DefaultGoBinary;
}

/**
 * The flags that are added to the go test command.
 */
export function testFlags(resource?: vscode.Uri): string[] {
  const value = readSetting<string[]>('testFlags', 'testFlags', Config.DefaultTestFlags, resource);
  if (!Array.isArray(value)) {
    return Config.DefaultTestFlags;
  }
  return value.filter((flag) => typeof flag === 'string');
}

/**
 * The build tags of a run.
 */
export function buildTags(resource?: vscode.Uri): string {
  const value = readSetting<string>('buildTags', 'buildTags', Config.DefaultBuildTags, resource);
  return typeof value === 'string' ? value : Config.DefaultBuildTags;
}

/**
 * The timeout of a run.
 *
 * The timeout of the Go extension is used when the user has not set one here,
 * and `30s` is used when neither has one: `go test` rejects the string
 * "undefined" as a duration, which would fail every test.
 */
export function timeout(resource?: vscode.Uri): string {
  return resolveTestTimeout(readSetting<unknown>('timeout', 'testTimeout', undefined, resource));
}

/**
 * The file that holds the environment variables of a run.
 */
export function envFile(resource?: vscode.Uri): string {
  const value = readSetting<string>('envFile', 'testEnvFile', Config.DefaultEnvFile, resource);
  return typeof value === 'string' ? value : Config.DefaultEnvFile;
}

/**
 * The environment variables of a run.
 */
export function env(resource?: vscode.Uri): { [key: string]: string } {
  const value = readSetting<{ [key: string]: string }>(
    'env',
    'testEnvVars',
    Config.DefaultEnv,
    resource,
  );
  if (!value || typeof value !== 'object') {
    return Config.DefaultEnv;
  }
  return value;
}

/**
 * Whether the output of a run goes to a terminal.
 */
export function runInTerminal(resource?: vscode.Uri): boolean {
  const value = readSetting<boolean>('runInTerminal', undefined, Config.RunInTerminal, resource);
  return typeof value === 'boolean' ? value : Config.RunInTerminal;
}

/**
 * The settings that decide how a test run is carried out.
 */
export interface RunSettings {
  /** The build tags of the run. */
  buildTags: string;
  /** The flags that are added to the go test command. */
  testFlags: string[];
  /** The timeout of the run. */
  timeout: string;
  /** The file that holds the environment variables of the run. */
  envFile: string;
  /** The environment variables of the run. */
  env: { [key: string]: string };
}

/**
 * Reads the settings of a run.
 *
 * The settings are read against the file under test, so that a run uses the
 * settings of that file rather than of whichever file happens to be open.
 */
export function runSettings(resource?: vscode.Uri): RunSettings {
  return {
    buildTags: buildTags(resource),
    testFlags: testFlags(resource),
    timeout: timeout(resource),
    envFile: envFile(resource),
    env: env(resource),
  };
}
