import * as vscode from 'vscode';
export class TestResult {

    constructor(
        public uri: vscode.Uri,
        public testName: string,
        public result: boolean,
        public output: string[],
        public error?: Error
    ) { }
}