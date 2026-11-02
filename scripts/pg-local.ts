/**
 * Local PostgreSQL for development — no Docker required.
 *
 * `embedded-postgres` downloads a real PostgreSQL 17 build on first run and
 * keeps its cluster in `.pgdata/`. The server is a child of this script, so the
 * script stays in the foreground: stop it with Ctrl+C.
 *
 *   npm run db:local        # start (keep this terminal open)
 *
 * Production uses a managed PostgreSQL (Vercel Postgres / Neon) via DATABASE_URL.
 */
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const PORT = Number(process.env.LOCAL_PG_PORT ?? 55432)
const USER = 'srds'
const PASSWORD = 'srds_local_dev'
const DATABASE = 'snowrealm_drama_studio'
const DATA_DIR = path.join(process.cwd(), '.pgdata')

export const LOCAL_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}?schema=public`

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    authMethod: 'password',
    persistent: true,
    onLog: () => {},
    onError: (err) => console.error('[postgres]', err),
  })

  const { existsSync } = await import('node:fs')
  const alreadyInitialised = existsSync(path.join(DATA_DIR, 'PG_VERSION'))

  if (!alreadyInitialised) {
    console.log('[pg-local] initialising cluster in .pgdata (first run downloads PostgreSQL)...')
    await pg.initialise()
  }

  console.log(`[pg-local] starting PostgreSQL on 127.0.0.1:${PORT} ...`)
  await pg.start()

  // createDatabase throws if it already exists; that is fine on restarts.
  try {
    await pg.createDatabase(DATABASE)
    console.log(`[pg-local] created database "${DATABASE}"`)
  } catch {
    console.log(`[pg-local] database "${DATABASE}" already present`)
  }

  console.log('[pg-local] READY')
  console.log(`[pg-local] DATABASE_URL=${LOCAL_DATABASE_URL}`)
  console.log('[pg-local] leave this process running; Ctrl+C to stop')

  const shutdown = async () => {
    console.log('\n[pg-local] stopping...')
    try {
      await pg.stop()
    } catch {
      /* exit-hook may already have stopped it */
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Keep the event loop alive so the cluster stays up.
  setInterval(() => {}, 1 << 30)
}

main().catch((err) => {
  console.error('[pg-local] failed:', err)
  process.exit(1)
})
