import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	test: {
		include: ['src/test/**/*.test.ts'],
		environment: 'node',
		// The tests that run the real go tool compile a package, which takes
		// well over the default 5 s when the build cache is cold.
		testTimeout: 60000,
		// The vscode module only exists inside an extension host, so unit tests
		// resolve it to a local mock instead.
		alias: {
			vscode: path.resolve(__dirname, 'src/test/mocks/vscode.ts')
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/test/**', 'src/**/*.d.ts']
		}
	}
});
