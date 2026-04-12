import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './tests/e2e-setup.js',
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 120000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'npm run server',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
