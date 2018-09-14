import * as vscode from 'vscode';
import * as path from 'path';
import { FileSystemProvider } from './fileSystemProvider';
import { Entry } from './entry';

export class TestFinder {

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
        var promises = resultfiles.map(([name, type]) =>
            this.getGoTestFiles(vscode.Uri.file(path.join(uri.fsPath, name))))
            
        return Promise.all(promises).then(results => {

            let output = results.map(r => [].concat(...r));
            return Promise.resolve(files.concat(...output));
        })


    }
    static filterGoTestFileOrDirectory(items: [string, vscode.FileType][]): [string, vscode.FileType][] {
        return items.filter(([name, type]) => name.endsWith("_test.go")
            && type === vscode.FileType.File
            || type === vscode.FileType.Directory
        )
    }
}