import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool as NodePool } from 'pg'
import { env, isNeonUrl } from '@/lib/env'
import * as schema from './schema'

/**
 * Production talks to Neon through `@neondatabase/serverless`'s WebSocket Pool
 * rather than its HTTP driver: creating 120 episodes with their 1,080 stage rows
 * has to be one transaction, and the HTTP driver cannot open one.
 *
 * A non-Neon URL (the local embedded-postgres cluster) uses a plain
 * node-postgres pool.
 *
 * Both drivers implement the same `PgDatabase` query surface, so one declared
 * type covers them. The cast in `createDb` is what keeps the fluent builder
 * usable — a union type here makes every `.returning()` call unresolvable.
 */

export type Database = NodePgDatabase<typeof schema>

const globalForDb = globalThis as unknown as {
  __srdsDb?: Database
  __srdsPool?: NeonPool | NodePool
}

function createDb(): Database {
  const { DATABASE_URL } = env()

  if (isNeonUrl(DATABASE_URL)) {
    // Node 22+ ships a global WebSocket, which the driver picks up on its own.
    neonConfig.poolQueryViaFetch = false

    const pool =
      (globalForDb.__srdsPool as NeonPool | undefined) ??
      new NeonPool({ connectionString: DATABASE_URL })
    globalForDb.__srdsPool = pool

    return drizzleNeon(pool, { schema, casing: 'snake_case' }) as unknown as Database
  }

  const pool =
    (globalForDb.__srdsPool as NodePool | undefined) ??
    new NodePool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 })
  globalForDb.__srdsPool = pool

  return drizzleNode(pool, { schema, casing: 'snake_case' })
}

function resolveDb(): Database {
  if (!globalForDb.__srdsDb) {
    globalForDb.__srdsDb = createDb()
  }
  return globalForDb.__srdsDb
}

/**
 * Lazily initialised. The connection is opened on first use rather than at
 * import time, so a plain node script can call `loadEnv()` in its own `main()`
 * — import hoisting would otherwise run `createDb()` before the env exists.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const real = resolveDb() as unknown as Record<string | symbol, unknown>
    const value = real[property]
    return typeof value === 'function' ? value.bind(real) : value
  },
  has(_target, property) {
    return property in (resolveDb() as unknown as object)
  },
})

/** Closes the pool so a script's process can exit. */
export async function closeDb(): Promise<void> {
  const pool = globalForDb.__srdsPool
  if (pool) {
    await pool.end()
    globalForDb.__srdsPool = undefined
    globalForDb.__srdsDb = undefined
  }
}

export { schema }
export * from './schema'
