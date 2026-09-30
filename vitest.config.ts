import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Integration tests spawn ssh-keygen/icacls; keep files sequential to avoid ACL races.
    fileParallelism: false
  }
});
