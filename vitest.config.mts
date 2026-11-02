import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests touch a shared database; run files serially.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
