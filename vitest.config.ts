import { defineConfig } from 'vitest/config';

// Tests run from the repo root so they can reach shared/ and tests/.
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
