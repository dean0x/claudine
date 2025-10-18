import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'], // Global test setup for cleanup
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        'vitest.config.ts',
        'tests/**/*'
      ]
    },
    testTimeout: 30000, // Increased for integration tests
    hookTimeout: 30000,
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.git'
    ],
    pool: 'forks', // Better isolation for integration tests
    poolOptions: {
      forks: {
        singleFork: true, // CRITICAL: Run all tests in single fork to prevent resource exhaustion
        maxForks: 1 // Only 1 test file at a time
      }
    },
    // CRITICAL: Run ALL tests sequentially to prevent crashes
    sequence: {
      concurrent: false,
      shuffle: false
    },
    // CRITICAL: Disable parallel test execution within files
    fileParallelism: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});