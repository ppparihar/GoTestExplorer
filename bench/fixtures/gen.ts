import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Fixture {
	root: string;
	packages: number;
	testsPerPackage: number;
	files: string[];
}

/**
 * Generates a throwaway Go module with a known number of packages and test
 * functions, so the benchmark measures a repeatable workload.
 */
export function generateFixture(root: string, packages = 20, testsPerPackage = 20): Fixture {
	fs.rmSync(root, { recursive: true, force: true });
	fs.mkdirSync(root, { recursive: true });

	fs.writeFileSync(path.join(root, 'go.mod'), 'module benchfixture\n\ngo 1.21\n');

	const files: string[] = [];
	for (let p = 0; p < packages; p++) {
		const pkgDir = path.join(root, `pkg${p}`);
		fs.mkdirSync(pkgDir, { recursive: true });

		const file = path.join(pkgDir, 'alpha_test.go');
		const functions: string[] = [];
		for (let t = 0; t < testsPerPackage; t++) {
			functions.push(`func TestAlpha${t}(t *testing.T) {\n\tt.Log("alpha ${t}")\n}\n`);
		}
		fs.writeFileSync(file, `package pkg${p}\n\nimport "testing"\n\n${functions.join('\n')}`);
		files.push(file);
	}

	return { root, packages, testsPerPackage, files };
}
