import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Clears provider credentials so no test can make a billed API call.
    setupFiles: ['./tests/setup.ts'],
    /*
     * `.tsx` 也要收：純渲染器（`RichText`）用 `renderToStaticMarkup` 驗得了，
     * 而它守的那幾條（編號不跳回 1、模型寫的標籤不會變成 HTML）沒有別的地方
     * 抓得到。
     */
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Integration tests touch a shared database; run files serially.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
