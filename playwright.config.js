import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env before any tests run
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

export default defineConfig({
  globalSetup: './tests/e2e-setup.js',
  globalTeardown: './tests/e2e-teardown.js',
  testDir: './tests',
  testMatch: '**/*.spec.js',
  // Disabled — kept on disk for future re-enabling.
  // - iphone13-audit: viewport audit, run manually when needed
  // - quiz: Triviandom UI is currently hidden; spec depends on visible button
  testIgnore: ['**/iphone13-audit.spec.js', '**/quiz.spec.js'],
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: `ENABLE_TEST_ROUTES=1 DB_PATH=./server/data/e2e.db REDIS_URL=${process.env.REDIS_URL || 'redis://127.0.0.1:6379'}/1 node -r ts-node/register server/index.js`,
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
