import * as vscode from 'vscode';
export class TestResult {

    constructor(
        public uri: vscode.Uri,
        public functionName: string,
        public result: boolean,
        public output: string[],
        public error?: Error
    ) { }
}