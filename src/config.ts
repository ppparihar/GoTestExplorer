export class Config {

    public static get SkipFolders(): string[] {
        return ["vendor",".vscode",".git"];
    }
    public static get RunMaxParallelTest(): number {
        return 20;
    }
}   