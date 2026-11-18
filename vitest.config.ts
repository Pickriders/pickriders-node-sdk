import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(version) },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: { include: ['src/**'], exclude: ['src/generated/**', 'src/**/*.test.ts'] },
  },
});
