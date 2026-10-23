/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	testMatch: ['**/*.test.ts'],
	modulePathIgnorePatterns: ['<rootDir>/dist/'],
	collectCoverageFrom: ['nodes/**/*.ts', 'credentials/**/*.ts', '!**/*.test.ts'],
};
