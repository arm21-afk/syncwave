import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.SYNCWAVE_TEST_PORT) || 3101;
const remote = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  use: { baseURL: remote || `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: remote
    ? undefined
    : {
        command: `npx cross-env PORT=${port} APP_ORIGIN=http://localhost:${port} npm run dev`,
        url: `http://localhost:${port}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
