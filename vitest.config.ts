import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Agent worktrees and example sites live inside the repo; their copies of the tests aren't ours.
  test: { include: ['test/**/*.test.ts'] },
});
