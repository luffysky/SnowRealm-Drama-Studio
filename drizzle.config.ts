import { defineConfig } from 'drizzle-kit'
import { loadEnv } from './src/lib/load-env'

loadEnv()

// Migrations must run over a direct (non-pooled) connection: PgBouncer's
// transaction mode cannot serve the session-level locks drizzle-kit takes.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL

if (!url) {
  throw new Error(
    'DATABASE_URL_UNPOOLED (or DATABASE_URL) is required. See docs/ENVIRONMENT.md'
  )
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
