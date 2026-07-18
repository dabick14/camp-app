import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    // Rules-unit-testing files each call initializeTestEnvironment against
    // the SAME shared emulator (Firestore and, since a second storage-rules
    // test file was added alongside tickets.rules.test.ts, Storage too).
    // Running test files in parallel races multiple concurrent rules
    // uploads against the same emulator, intermittently hitting a window
    // where the ruleset isn't loaded yet ("no Storage ruleset is currently
    // loaded"). Serializing files removes the race; the whole suite still
    // runs in seconds.
    fileParallelism: false,
  },
})
