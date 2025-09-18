import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
        singleFork: false,
        maxForks: 2 // Limit concurrent test files to prevent process overload
      }
    },
    // Run stress tests sequentially to prevent system overload
    sequence: {
      concurrent: false,
      shuffle: false
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});