import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Fixture {
	root: string;
	packages: number;
	testsPerPackage: number;
	filesPerPackage: number;
	files: string[];
}

/**
 * Generates a throwaway Go module with a known number of packages and test
 * functions, so the benchmark measures a repeatable workload.
 *
 * @param root the directory to create the fixture in.
 * @param packages the number of packages to generate.
 * @param testsPerPackage the number of test functions in each file.
 * @param filesPerPackage the number of test files in each package.
 */
export function generateFixture(root: string, packages = 20, testsPerPackage = 20, filesPerPackage = 1): Fixture {
	fs.rmSync(root, { recursive: true, force: true });
	fs.mkdirSync(root, { recursive: true });

	fs.writeFileSync(path.join(root, 'go.mod'), 'module benchfixture\n\ngo 1.21\n');

	const files: string[] = [];
	for (let p = 0; p < packages; p++) {
		const pkgDir = path.join(root, `pkg${p}`);
		fs.mkdirSync(pkgDir, { recursive: true });

		for (let f = 0; f < filesPerPackage; f++) {
			const file = path.join(pkgDir, `alpha${f}_test.go`);
			const functions: string[] = [];
			for (let t = 0; t < testsPerPackage; t++) {
				functions.push(`func TestAlpha${f}_${t}(t *testing.T) {\n\tt.Log("alpha ${t}")\n}\n`);
			}
			fs.writeFileSync(file, `package pkg${p}\n\nimport "testing"\n\n${functions.join('\n')}`);
			files.push(file);
		}
	}

	return { root, packages, testsPerPackage, filesPerPackage, files };
}
