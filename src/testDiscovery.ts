import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { TestNode } from "./testNode";
import { getTestFunctions, isToolAvailable } from "./lib/testUtil";
import { Commands } from "./commands";
import { Entry } from "./entry";
import { FileSystemProvider } from "./fileSystemProvider";
import { Config } from "./config";

export class TestDiscovery {

    constructor(private commands: Commands){}

    discoverAllTests() {
        this.commands.sendTestDiscoveryStarted();

        const workspaceFolders = (vscode.workspace.workspaceFolders || [])
            .filter(folder => folder.uri.scheme === 'file');

        if (workspaceFolders.length === 0) {
            this.commands.sendDiscoveredTests([]);
            return;
        }

        if (!isToolAvailable('go-outline')) {
            // Reporting this once, up front, is the difference between an
            // actionable message and an empty tree with no explanation.
            vscode.window.showErrorMessage(
                'Cannot find "go-outline", which Go Test Explorer uses to list the tests in a file. '
                + 'Install it with "go install github.com/ramya-rao-a/go-outline@latest" and make sure '
                + 'its location is on your PATH, then refresh the test view.');
            this.commands.sendDiscoveredTests([]);
            return;
        }

        Promise.all(workspaceFolders.map(folder => this.discoverFolderTests(folder.uri)))
            .then(results => {
                this.commands.sendDiscoveredTests([].concat(...results));
            })
            .catch(err => {
                vscode.window.showErrorMessage('An error occurred: ' + err);
                this.commands.sendDiscoveredTests([]);
            });
    }

    /**
     * Discovers the tests under a single workspace folder. A folder with a
     * `src` directory is scanned from there, otherwise from the folder root.
     */
    private async discoverFolderTests(folderUri: vscode.Uri): Promise<TestNode[]> {
        const srcLocation = path.join(folderUri.fsPath, "src");
        const root = await directoryExists(srcLocation) ? srcLocation : folderUri.fsPath;
        return this.discoverTests(vscode.Uri.file(root));
    }

async discoverTests(uri: vscode.Uri): Promise<TestNode[]> {
        const items = await TestDiscovery.getGoTestFiles(uri);
        const suites = await Promise.all(items.map(async item => {
            let suite = new TestNode(item.name, item.uri);
            let symbols = await getTestFunctions(suite.uri, null);

            symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
            let nodeList = symbols.map(symbol => new TestNode(`${symbol.name}`, suite.uri));
            return new TestNode(suite.name, suite.uri, nodeList);
        }));
        return suites;
    }

    static async getGoTestFiles(uri: vscode.Uri): Promise<Entry[]> {
        const fileSystemProvider = new FileSystemProvider();

        const children = await fileSystemProvider.readDirectory(uri);
        const results = this.filterGoTestFileOrDirectory(children);
        let files = results.filter(([name, type]) => type === vscode.FileType.File)
            .map(([name, type]) => ({ name: name, uri: vscode.Uri.file(path.join(uri.fsPath, name)), type }));

        let resultfiles = TestDiscovery.filterOutSkipFolders(results);
        if (resultfiles.length === 0) {
            return Promise.resolve(files);
        }
        var promises = resultfiles.map(([name, type]) =>
            this.getGoTestFiles(vscode.Uri.file(path.join(uri.fsPath, name))));

        return Promise.all(promises).then(results => {
            let output = results.map(r => [].concat(...r));
            return Promise.resolve(files.concat(...output));
        });
    }

    private static filterOutSkipFolders(results: [string, vscode.FileType][]) {
        return results.filter(([name, type]) => {
            const basename = path.basename(name);
            return type === vscode.FileType.Directory && Config.SkipFolders.indexOf(basename) === -1;
        });
    }

    static filterGoTestFileOrDirectory(items: [string, vscode.FileType][]): [string, vscode.FileType][] {
        return items.filter(([name, type]) => name.endsWith("_test.go")
            && type === vscode.FileType.File
            || type === vscode.FileType.Directory
        );
    }
}

function directoryExists(target: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        fs.stat(target, (err, stat) => resolve(!err && stat.isDirectory()));
    });
}
