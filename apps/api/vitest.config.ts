import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is used instead of esbuild/oxc so NestJS decorator metadata is emitted in tests.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
      },
    }),
  ],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
