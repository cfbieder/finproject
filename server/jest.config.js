/**
 * Jest Configuration
 *
 * Configuration for running tests in the server application.
 * Uses Node.js test environment for testing server-side code.
 */

module.exports = {
  // Use Node.js environment for server-side testing
  testEnvironment: "node",

  // Directory where Jest should output coverage files
  coverageDirectory: "coverage",

  // Pattern to find test files
  testMatch: ["**/__tests__/**/*.test.js"],

  // Exclude patterns
  testPathIgnorePatterns: ["/node_modules/"],

  // Collect coverage from these files
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/**/__tests__/**",
    "!src/**/*.test.js",
    "!src/**/*.spec.js",
  ],

  // Coverage thresholds (optional - can be adjusted based on needs)
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },

  // Timeout for tests (increased for database operations)
  testTimeout: 10000,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Global setup for danfojs localStorage requirement
  globals: {
    localStorage: {},
  },
};
