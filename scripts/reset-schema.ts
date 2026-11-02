/**
 * Drops and recreates the `public` schema, then leaves the database empty.
 * Intended for local development; refuses to touch a Neon host unless
 * `--force-remote` is passed explicitly.
 *
 *   npm run db:reset
 */
import { Client } from 'pg'
import { loadEnv } from '../src/lib/load-env'

async function main() {
  loadEnv()

  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required')
  }
  if (/neon\.(tech|build)/.test(url) && !process.argv.includes('--force-remote')) {
    throw new Error(
      'Refusing to drop the schema on a Neon database.\n' +
        'Re-run with --force-remote only if you really mean to erase it.'
    )
  }

  const client = new Client({ connectionString: url })
  await client.connect()
  await client.query('drop schema if exists public cascade; create schema public;')
  await client.end()
  console.log('[reset-schema] public schema recreated (empty)')
}

main().catch((err) => {
  console.error('[reset-schema] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
