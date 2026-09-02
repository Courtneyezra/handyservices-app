import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Two vitest projects (close-out pane P6):
 *   server — the original node suite, byte-for-byte the previous config (42 pre-existing failures
 *            are the baseline; see docs/RUNBOOK.md "Verification rule").
 *   client — jsdom + Testing Library for the admin UI (`npm run test:client`); must stay green.
 * `npx vitest run` runs both; `--project server|client` runs one.
 */
export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.test.tsx'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          setupFiles: ['server/__tests__/setup.ts'],
          include: ['server/**/*.test.ts', 'server/**/*.spec.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 10000,
        },
      },
      {
        extends: true,
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'client',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['client/test-setup.ts'],
          include: ['client/src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 10000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client', 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@assets': path.resolve(__dirname, 'src', 'assets'),
      '@test-utils': path.resolve(__dirname, 'client', 'test-utils.tsx'),
    },
  },
});
