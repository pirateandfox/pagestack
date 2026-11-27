import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Agent worktrees and example sites live inside the repo; their copies of the tests aren't ours.
    include: ['test/**/*.test.ts'],
    // Node 25+ has its own localStorage, which hides happy-dom's and does nothing without a file.
    execArgv: ['--no-experimental-webstorage'],
  },
});
