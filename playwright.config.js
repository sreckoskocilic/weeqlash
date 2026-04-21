import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './tests/e2e-setup.js',
  globalTeardown: './tests/e2e-teardown.js',
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'node server/index.js',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
