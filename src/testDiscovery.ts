import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { TestNode } from "./testNode";
import { getTestFunctions } from "./lib/testUtil";
import { Commands } from "./commands";
import { Entry } from "./entry";
import { FileSystemProvider } from "./fileSystemProvider";
import { Config } from "./config";

export class TestDiscovery {

    constructor(private commands: Commands){}
   
    discoverAllTests() {
        this.commands.sendTestDiscoveryStarted();
        const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
        let srcLocation = path.join(workspaceFolder.uri.path, "src");
        fs.exists(srcLocation, (exists) => {
            srcLocation = exists ? srcLocation : workspaceFolder.uri.path;
            const uri = vscode.Uri.file(srcLocation);
            this.discoverTests(uri).catch(err => {
                vscode.window.showErrorMessage('An error occurred: '+err);
                this.commands.sendDiscoveredTests([]); 
            });
        });
    }

    async discoverTests(uri: vscode.Uri) {
        const items = await TestDiscovery.getGoTestFiles(uri);
        let promises = items.map(async item => {
            let suite = new TestNode(item.name, item.uri);
            let symbols = await getTestFunctions(suite.uri, null);

            symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
            let nodeList = symbols.map(symbol => new TestNode(`${symbol.name}`, suite.uri));
            return new TestNode(suite.name, suite.uri, nodeList);
        });

        Promise.all(promises).then(testNodeList => {
            this.commands.sendDiscoveredTests([].concat(...testNodeList)); 
        });
    }

    static async getGoTestFiles(uri: vscode.Uri): Promise<Entry[]> {
        const fileSystemProvider = new FileSystemProvider();

        const children = await fileSystemProvider.readDirectory(uri);
        const results = this.filterGoTestFileOrDirectory(children);
        let files = results.filter(([name, type]) => type === vscode.FileType.File)
            .map(([name, type]) => ({ name: name, uri: vscode.Uri.file(path.join(uri.fsPath, name)), type }));

        let resultfiles = TestDiscovery.filterSkipFolders(results);
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

    private static filterSkipFolders(results: [string, vscode.FileType][]) {
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