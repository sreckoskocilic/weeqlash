import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.js'],
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup-env.js'],
    envFilePath: '.env',
  },
});
