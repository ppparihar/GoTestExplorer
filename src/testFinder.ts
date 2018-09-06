import * as vscode from 'vscode';
import * as path from 'path';
import { FileSystemProvider } from './fileSystemProvider';
import { Entry } from './entry';

export class TestFinder {

    static async  getChildren(element?: Entry): Promise<Entry[]> {
        if (element) {
            const fileSystemProvider = new FileSystemProvider();
            const children = await fileSystemProvider.readDirectory(element.uri);
            return this.filterGoTestFileOrDirectory(children).map(([name, type]) => ({ name: name, uri: vscode.Uri.file(path.join(element.uri.fsPath, name)), type }));
        }

        const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
        if (workspaceFolder) {
            return this.getGoTestFiles(workspaceFolder.uri);
        }

        return [];
    }
    static async getGoTestFiles(uri: vscode.Uri): Promise<Entry[]> {
        const fileSystemProvider = new FileSystemProvider();

        const children = await fileSystemProvider.readDirectory(uri);
        const results = this.filterGoTestFileOrDirectory(children);
        let files = results.filter(([name, type]) => type === vscode.FileType.File)
            .map(([name, type]) => ({ name: name, uri: vscode.Uri.file(path.join(uri.fsPath, name)), type }));


        let resultfiles = results.filter(([name, type]) => type === vscode.FileType.Directory)
        if (resultfiles.length == 0) {
            return Promise.resolve(files);
        }
        var promises = resultfiles.map(([name, type]) => {
            return this.getGoTestFiles(vscode.Uri.file(path.join(uri.fsPath, name)))

        })
        return Promise.all(promises).then(function (results) {
            results.forEach(element => {
                element.forEach(item => {
                    files.push(item)
                })

            });
            return Promise.resolve(files);
        })


    }
    static filterGoTestFileOrDirectory(items: [string, vscode.FileType][]): [string, vscode.FileType][] {
        var result = items.filter(([name, type]) => name.endsWith("_test.go") && type === vscode.FileType.File || type === vscode.FileType.Directory)
        return result;
    }
}