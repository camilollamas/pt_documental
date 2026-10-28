import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Los archivos e2e comparten la base documents_test (TRUNCATE): se ejecutan en serie.
    fileParallelism: false,
  },
});
