import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '../config';
import { DEFAULT_TEST_TIMEOUT } from '../lib/testArgs';
import {
  readSetting,
  userSetValue,
  maxPackagesPerRun,
  maxParallelTests,
  skipFolders,
  goPath,
  goBinary,
  testFlags,
  buildTags,
  timeout,
  envFile,
  env,
  runInTerminal,
  includePaths,
  excludePatterns,
  showFilesWithoutTests,
  runSettings,
} from '../lib/settings';
import { getGoBinaryPath } from '../lib/testUtil';
import { __reset, __setConfiguration, Uri } from './mocks/vscode';

const testUri = Uri.file('/repo/pkg/alpha_test.go');

beforeEach(() => {
  __reset();
});

describe('readSetting', () => {
  it('uses the setting of this extension when the user set it', () => {
    __setConfiguration('goTestExplorer', { testFlags: ['-count=1'] });
    __setConfiguration('go', { testFlags: ['-v'] });

    expect(readSetting('testFlags', 'testFlags', [], testUri)).toEqual(['-count=1']);
  });

  it('falls back to the setting of the Go extension', () => {
    __setConfiguration('go', { testFlags: ['-v'] });

    expect(readSetting('testFlags', 'testFlags', [], testUri)).toEqual(['-v']);
  });

  it('uses the default when neither extension has a value', () => {
    expect(readSetting('testFlags', 'testFlags', ['-default'], testUri)).toEqual(['-default']);
  });

  it('uses the default for a setting that has no Go equivalent', () => {
    __setConfiguration('go', { testFlags: ['-v'] });

    expect(readSetting('maxParallelTests', undefined, 20, testUri)).toBe(20);
  });

  it('reads the setting against the given file', () => {
    const other = Uri.file('/repo/other/beta_test.go');
    __setConfiguration('goTestExplorer', (resource?: Uri) => ({
      buildTags: resource && resource.fsPath === other.fsPath ? 'integration' : '',
    }));

    expect(readSetting('buildTags', undefined, '', other)).toBe('integration');
  });
});

describe('userSetValue', () => {
  it('takes the most specific scope', () => {
    expect(
      userSetValue({
        globalValue: 'global',
        workspaceValue: 'workspace',
        workspaceFolderValue: 'folder',
      }),
    ).toBe('folder');
    expect(userSetValue({ globalValue: 'global', workspaceValue: 'workspace' })).toBe('workspace');
    expect(userSetValue({ globalValue: 'global' })).toBe('global');
  });

  it('ignores the default of the setting', () => {
    expect(userSetValue({ defaultValue: 'default' })).toBeUndefined();
  });

  it('returns undefined when nothing was inspected', () => {
    expect(userSetValue(undefined)).toBeUndefined();
  });
});

describe('maxPackagesPerRun', () => {
  it('has no limit on the number by default', () => {
    expect(maxPackagesPerRun()).toBe(0);
  });

  it('reads the setting', () => {
    __setConfiguration('goTestExplorer', { maxPackagesPerRun: 50 });

    expect(maxPackagesPerRun()).toBe(50);
  });

  it('falls back to no limit for a negative or invalid value', () => {
    __setConfiguration('goTestExplorer', { maxPackagesPerRun: -3 });
    expect(maxPackagesPerRun()).toBe(0);

    __setConfiguration('goTestExplorer', { maxPackagesPerRun: 'many' });
    expect(maxPackagesPerRun()).toBe(0);
  });

  it('rounds a fraction down', () => {
    __setConfiguration('goTestExplorer', { maxPackagesPerRun: 7.9 });

    expect(maxPackagesPerRun()).toBe(7);
  });
});

describe('maxParallelTests', () => {
  it('defaults to the configured maximum', () => {
    expect(maxParallelTests()).toBe(Config.RunMaxParallelTest);
  });

  it('uses the setting', () => {
    __setConfiguration('goTestExplorer', { maxParallelTests: 4 });

    expect(maxParallelTests()).toBe(4);
  });

  it('falls back to the default for a value below one', () => {
    __setConfiguration('goTestExplorer', { maxParallelTests: 0 });

    expect(maxParallelTests()).toBe(Config.RunMaxParallelTest);
  });

  it('floors a fractional value', () => {
    __setConfiguration('goTestExplorer', { maxParallelTests: 2.9 });

    expect(maxParallelTests()).toBe(2);
  });
});

describe('skipFolders', () => {
  it('defaults to the folders that are never walked', () => {
    expect(skipFolders()).toEqual(Config.SkipFolders);
    expect(skipFolders()).toContain('vendor');
  });

  it('uses the setting', () => {
    __setConfiguration('goTestExplorer', { skipFolders: ['vendor', 'fixtures'] });

    expect(skipFolders()).toEqual(['vendor', 'fixtures']);
  });

  it('falls back to the default for an empty list', () => {
    __setConfiguration('goTestExplorer', { skipFolders: [] });

    expect(skipFolders()).toEqual(Config.SkipFolders);
  });

  it('drops entries that are not names', () => {
    __setConfiguration('goTestExplorer', { skipFolders: ['', '  ', 'fixtures', 42] });

    expect(skipFolders()).toEqual(['fixtures']);
  });
});

describe('goPath', () => {
  it('falls back to the GOPATH of the Go extension', () => {
    __setConfiguration('go', { gopath: '/go/path' });

    expect(goPath()).toBe('/go/path');
  });

  it('uses the setting of this extension first', () => {
    __setConfiguration('goTestExplorer', { goPath: '/own/path' });
    __setConfiguration('go', { gopath: '/go/path' });

    expect(goPath()).toBe('/own/path');
  });
});

describe('goBinary', () => {
  it('is empty when the user has not set it', () => {
    expect(goBinary()).toBe('');
  });

  it('uses the setting', () => {
    __setConfiguration('goTestExplorer', { goBinary: '/opt/go/bin/go' });

    expect(goBinary()).toBe('/opt/go/bin/go');
  });
});

describe('testFlags', () => {
  it('falls back to the flags of the Go extension', () => {
    __setConfiguration('go', { testFlags: ['-v', '-count=1'] });

    expect(testFlags()).toEqual(['-v', '-count=1']);
  });

  it('is empty when neither extension has a value', () => {
    expect(testFlags()).toEqual([]);
  });
});

describe('buildTags', () => {
  it('falls back to the tags of the Go extension', () => {
    __setConfiguration('go', { buildTags: 'integration' });

    expect(buildTags()).toBe('integration');
  });
});

describe('timeout', () => {
  it('defaults to 30s so that go test never sees "undefined"', () => {
    expect(timeout()).toBe(DEFAULT_TEST_TIMEOUT);
    expect(timeout()).not.toBe('undefined');
  });

  it('falls back to the timeout of the Go extension', () => {
    __setConfiguration('go', { testTimeout: '90s' });

    expect(timeout()).toBe('90s');
  });

  it('uses the setting of this extension first', () => {
    __setConfiguration('goTestExplorer', { timeout: '5m' });
    __setConfiguration('go', { testTimeout: '90s' });

    expect(timeout()).toBe('5m');
  });

  it('falls back to the default for an empty value', () => {
    __setConfiguration('goTestExplorer', { timeout: '' });

    expect(timeout()).toBe(DEFAULT_TEST_TIMEOUT);
  });
});

describe('envFile', () => {
  it('falls back to the file of the Go extension', () => {
    __setConfiguration('go', { testEnvFile: '/repo/.env' });

    expect(envFile()).toBe('/repo/.env');
  });
});

describe('env', () => {
  it('falls back to the variables of the Go extension', () => {
    __setConfiguration('go', { testEnvVars: { CGO_ENABLED: '0' } });

    expect(env()).toEqual({ CGO_ENABLED: '0' });
  });

  it('is empty when neither extension has a value', () => {
    expect(env()).toEqual({});
  });
});

describe('runInTerminal', () => {
  it('is on by default', () => {
    expect(runInTerminal()).toBe(true);
  });

  it('uses the setting', () => {
    __setConfiguration('goTestExplorer', { runInTerminal: false });

    expect(runInTerminal()).toBe(false);
  });
});

describe('showFilesWithoutTests', () => {
  it('is off by default', () => {
    expect(showFilesWithoutTests()).toBe(false);
  });

  it('uses the setting', () => {
    __setConfiguration('goTestExplorer', { showFilesWithoutTests: true });

    expect(showFilesWithoutTests()).toBe(true);
  });
});

describe('includePaths and excludePatterns', () => {
  it('are empty by default', () => {
    expect(includePaths()).toEqual([]);
    expect(excludePatterns()).toEqual([]);
  });

  it('read the list the user wrote, without blanks', () => {
    __setConfiguration('goTestExplorer', { includePaths: ['api', ' ', 'worker'] });

    expect(includePaths()).toEqual(['api', 'worker']);
  });

  it('join the exclude paths and the folders files.exclude hides', () => {
    __setConfiguration('goTestExplorer', { excludePaths: ['gen/**'] });
    __setConfiguration('files', {
      exclude: { '**/.git': true, '**/*.js': false, '**/*.go': { when: '$(basename).x' } },
    });

    expect(excludePatterns()).toEqual(['gen/**', '**/.git']);
  });

  it('leave files.exclude out when the user turned it off', () => {
    __setConfiguration('goTestExplorer', { excludePaths: ['gen/**'], useFilesExclude: false });
    __setConfiguration('files', { exclude: { '**/.git': true } });

    expect(excludePatterns()).toEqual(['gen/**']);
  });
});

describe('runSettings', () => {
  it('composes the settings of a run', () => {
    __setConfiguration('goTestExplorer', { timeout: '2m', runInTerminal: false });
    __setConfiguration('go', {
      testFlags: ['-v'],
      buildTags: 'integration',
      testEnvFile: '/repo/.env',
      testEnvVars: { CGO_ENABLED: '0' },
    });

    expect(runSettings(testUri)).toEqual({
      buildTags: 'integration',
      testFlags: ['-v'],
      timeout: '2m',
      envFile: '/repo/.env',
      env: { CGO_ENABLED: '0' },
    });
  });
});

describe('the settings declared in package.json', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
  );
  const properties = packageJson.contributes.configuration.properties;

  it('declares a default for every setting the code reads', () => {
    const keys = [
      'maxParallelTests',
      'maxPackagesPerRun',
      'skipFolders',
      'goPath',
      'goBinary',
      'testFlags',
      'buildTags',
      'timeout',
      'envFile',
      'env',
      'runInTerminal',
    ];
    keys.forEach((key) => expect(properties[`goTestExplorer.${key}`]).toBeDefined());
  });

  it('declares the same defaults as the code', () => {
    expect(properties['goTestExplorer.maxParallelTests'].default).toBe(Config.RunMaxParallelTest);
    expect(properties['goTestExplorer.maxPackagesPerRun'].default).toBe(
      Config.DefaultMaxPackagesPerRun,
    );
    expect(properties['goTestExplorer.skipFolders'].default).toEqual(Config.SkipFolders);
    expect(properties['goTestExplorer.goPath'].default).toBe(Config.DefaultGoPath);
    expect(properties['goTestExplorer.goBinary'].default).toBe(Config.DefaultGoBinary);
    expect(properties['goTestExplorer.testFlags'].default).toEqual(Config.DefaultTestFlags);
    expect(properties['goTestExplorer.buildTags'].default).toBe(Config.DefaultBuildTags);
    expect(properties['goTestExplorer.timeout'].default).toBe(DEFAULT_TEST_TIMEOUT);
    expect(properties['goTestExplorer.envFile'].default).toBe(Config.DefaultEnvFile);
    expect(properties['goTestExplorer.env'].default).toEqual(Config.DefaultEnv);
    expect(properties['goTestExplorer.runInTerminal'].default).toBe(Config.RunInTerminal);
  });
});

describe('getGoBinaryPath', () => {
  it('uses the binary the user named', () => {
    __setConfiguration('goTestExplorer', { goBinary: '/opt/go/bin/go' });

    expect(getGoBinaryPath(testUri)).toBe('/opt/go/bin/go');
  });

  it('looks in the bin folder of the GOPATH', () => {
    const gopath = fs.mkdtempSync(path.join(os.tmpdir(), 'gtest-gopath-'));
    const bin = path.join(gopath, 'bin');
    fs.mkdirSync(bin);
    const binary = path.join(bin, process.platform === 'win32' ? 'go.exe' : 'go');
    fs.writeFileSync(binary, '');
    try {
      __setConfiguration('goTestExplorer', { goPath: gopath });

      expect(getGoBinaryPath(testUri)).toBe(binary);
    } finally {
      fs.rmSync(gopath, { recursive: true, force: true });
    }
  });

  it('falls back to the binary on the PATH', () => {
    const binary = getGoBinaryPath(testUri);

    expect(binary).toBeTruthy();
  });
});
