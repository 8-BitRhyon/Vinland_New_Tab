/**
 * Vinland New Tab — Playwright Configuration
 *
 * Run with:
 *   npx playwright test
 *   npx playwright test --headed  (see browser window)
 *   npx playwright test --ui     (interactive UI mode)
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.playwright.spec.mjs',
  timeout: 30000,
  retries: 1,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:9999',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'for p in 8080 8181 9999; do lsof -ti :$p | xargs kill -9 2>/dev/null; done; python3 -m http.server 9999',
    url: 'http://127.0.0.1:9999',
    reuseExistingServer: true,
    cwd: '.',
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],
});
