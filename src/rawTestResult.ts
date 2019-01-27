export class RawTestResult {
    constructor(
        public isPassed: boolean,
        public output: string[],
        public failedTests: string[],
        public err?: Error
    ) { }
}