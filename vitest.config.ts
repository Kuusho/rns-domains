import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.behaviour.ts'],
    reporters: ['verbose'],
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // The heaviest integration suites (e.g. IntegrationRegistration,
    // IntegrationMultiYear, IntegrationSubdomain) run the full Phase 1-8
    // in-process deploy chain once per it() block via loadAndExecuteDeployments.
    // With Phase 8's larger chain a single chain run is ~20-25s, far exceeding
    // vitest's 5s default — every loadFixture block times out, and the piled-up
    // pending deploys also exhaust the worker heap (ERR_IPC_CHANNEL_CLOSED).
    // Raise the global test/hook timeout (the DEFERRED-08-02-01 fix prescribed
    // in STATE.md) and the fork worker heap so these suites complete. Unit
    // suites are unaffected (they finish in milliseconds).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=6144'],
      },
    },
  },
  esbuild: {
    target: 'node22',
    format: 'esm',
  },
})
