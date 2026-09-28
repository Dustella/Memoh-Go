import { defineConfig } from 'vitest/config';

// Unit tests cover the framework-free layers (core, application, data adapters
// with injected ports). React Native code is verified on device instead.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
