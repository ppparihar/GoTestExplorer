export class RawTestResult {
    constructor(
        public isPassed: boolean, 
        public output: string[], 
        public err?: Error
        ) { }
}