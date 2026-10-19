import { defineConfig, devices } from '@playwright/test';

const liveURL = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: { baseURL: liveURL || 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: liveURL ? undefined : {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
