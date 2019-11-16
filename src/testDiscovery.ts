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
        let promises = TestDiscovery.parseTests(items);

        Promise.all(promises).then(testNodeList => {
            this.commands.sendDiscoveredTests([].concat(...testNodeList));
        });
    }

    async rediscoverTests(uri: vscode.Uri) {
        const items = await TestDiscovery.getGoTestFiles(uri);
        let promises = TestDiscovery.parseTests(items);

        Promise.all(promises).then(testNodeList => {
            this.commands.sendRediscoveredTests([].concat(...testNodeList));
        });
    }

    static parseTests(items: Entry[]): Promise<TestNode>[] {
        return items.map(async item => {
            let suite = new TestNode(item.name, item.uri);
            let symbols = await getTestFunctions(suite.uri, null);

            symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
            let nodeList = symbols.map(symbol => new TestNode(`${symbol.name}`, suite.uri));
            return new TestNode(suite.name, suite.uri, nodeList);
        });
    }

    private static async getAllSubfiles(uri: vscode.Uri): Promise<Entry[]> {
        const fileSystemProvider = new FileSystemProvider();

        let subfiles: Entry[] = [];
        const stat = await fileSystemProvider.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
            const dir = await fileSystemProvider.readDirectory(uri);
            const entries: Entry[] = dir.map(([name, type]) => ({
                name: name,
                uri: vscode.Uri.file(path.join(uri.fsPath, name)),
                type: type,
            }));
            const promises = entries.map(async e => {
                if (e.type === vscode.FileType.File) {
                    return [e];
                } else if (e.type === vscode.FileType.Directory) {
                    const subentries = await this.getAllSubfiles(e.uri);
                    return subentries;
                }
            });
            const children = await Promise.all(promises);
            children.forEach(entries => subfiles.push(...entries))
        } else if (stat.type === vscode.FileType.File) {
            const name = path.basename(uri.fsPath);
            subfiles.push({ name: name, uri: uri, type: stat.type });
        }
        return subfiles;
    }

    static async getGoTestFiles(uri: vscode.Uri): Promise<Entry[]> {
        const subfiles: Entry[] = await this.getAllSubfiles(uri);
        const results: Entry[] = this.filterGoTestFile(subfiles);
        let files: Entry[] = results.filter(e => e.type === vscode.FileType.File);

        let resultfiles = TestDiscovery.filterOutSkipFolders(results);
        if (resultfiles.length === 0) {
            return Promise.resolve(files);
        }

        var promises = resultfiles.map(e =>
            this.getGoTestFiles(vscode.Uri.file(path.join(uri.fsPath, e.name))));

        return Promise.all(promises).then(results => {
            let output = results.map(r => [].concat(...r));
            return Promise.resolve(files.concat(...output));
        });
    }

    private static filterOutSkipFolders(results: Entry[]) {
        return results.filter(e => {
            const basename = path.basename(e.name);
            return e.type === vscode.FileType.Directory && Config.SkipFolders.indexOf(basename) === -1;
        });
    }

    static filterGoTestFile(items: Entry[]): Entry[] {
        return items.filter(e => this.validGoTestFile(e.name, e.type));
    }

    static validGoTestFile(name: string, type: vscode.FileType): boolean {
        return name.endsWith('_test.go')
            && type === vscode.FileType.File
            || type === vscode.FileType.Directory;
    }
}