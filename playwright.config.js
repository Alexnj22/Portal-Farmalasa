import { defineConfig, devices } from '@playwright/test';

// Smoke suite corre contra `vite preview` (build de producción), no el dev
// server (ver reference_qa_browser_setup: dev server históricamente
// inestable para pruebas automatizadas en este proyecto).
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:4174',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: process.env.E2E_BASE_URL ? undefined : {
        command: 'npm run build && npm run preview -- --port 4174',
        url: 'http://localhost:4174',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
