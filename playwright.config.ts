import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the v2 booking smoke test.
 *
 * The dev server boots on port 5001 (see server/index.ts — `PORT` env var
 * defaulting to 5001). We point `baseURL` and `webServer.port` at that so
 * `page.goto("/v2")` resolves correctly.
 *
 * `viewport` is mobile-sized because the v2 floating Menu pill (and the
 * sticky cart bar) only render on screens narrower than the `lg` breakpoint.
 * Testing at mobile width exercises the most components.
 */
export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: "http://localhost:5001",
        viewport: { width: 390, height: 844 }, // iPhone-ish portrait
        trace: "retain-on-failure",
        video: "retain-on-failure",
    },
    webServer: {
        command: "npm run dev",
        url: "http://localhost:5001",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
