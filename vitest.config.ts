import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@typora-community-plugin/core': fileURLToPath(new URL('./test/support/typora-core.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    restoreMocks: true,
    maxWorkers: 2,
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'test/**/*.test.ts',
    ],
  },
})
