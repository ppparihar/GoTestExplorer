export class Config {

    public static get SkipFolders(): string[] {
        return ["vendor"]
    }
    public static get RunMaxParallelTest(): number {
        return 20
    }
}   