import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { TestNode } from "./testNode";
import { Commands } from "./commands";
import { discoverTests, DiscoveredSuite } from "./discovery/discover";

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
        const suites = await discoverTests(uri.fsPath);
        return suites.map(suite => {
            if (!suite.confident) {
                // A file that cannot be scanned with confidence is broken Go,
                // so it is reported rather than quietly listed with fewer
                // tests than it declares.
                console.warn(`go-test-explorer: ${suite.file} could not be scanned (${suite.reason}); the tests it declares may be missing.`);
            }
            return this.buildSuiteNode(suite);
        });
    }

    /**
     * Builds the tree node for one test file.
     *
     * A file with no test functions still gets a node, so that the tree
     * shows that the file was seen and found to hold nothing runnable.
     */
    private buildSuiteNode(suite: DiscoveredSuite): TestNode {
        const uri = vscode.Uri.file(suite.file);
        const sorted = suite.declarations.slice().sort((a, b) => a.name.localeCompare(b.name));
        const children = sorted.map(declaration => new TestNode(declaration.name, uri));
        return new TestNode(path.basename(suite.file), uri, children);
    }
}

function directoryExists(target: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        fs.stat(target, (err, stat) => resolve(!err && stat.isDirectory()));
    });
}
