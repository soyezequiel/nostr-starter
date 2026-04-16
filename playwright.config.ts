import { defineConfig, devices } from 'playwright/test'

const PORT = 3000
const HOST = 'localhost'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname ${HOST} --port ${PORT}`,
    url: `http://${HOST}:${PORT}/labs/sigma?fixture=drag-local&testMode=1`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
