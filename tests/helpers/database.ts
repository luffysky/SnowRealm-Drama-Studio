import { loadEnv } from '@/lib/load-env'

/**
 * Database URL for the destructive test suites.
 *
 * These tests truncate tables and reset password hashes, so they must never
 * touch a real deployment. `TEST_DATABASE_URL` lets the app point at Neon while
 * tests keep using the local cluster; without it they fall back to
 * `DATABASE_URL` and refuse to run when that is a Neon host.
 */
export function resolveTestDatabaseUrl(): { url: string; usable: boolean } {
  loadEnv()

  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
  const isNeon = /neon\.(tech|build)/.test(url)

  return { url, usable: Boolean(url) && !isNeon }
}

/**
 * Points this process at the test database, so `@/db` connects there rather
 * than wherever the app is configured. Returns false when no safe database is
 * available, which the suites use to skip instead of running somewhere unsafe.
 */
export function testDatabaseReady(): boolean {
  const { url, usable } = resolveTestDatabaseUrl()
  if (!usable) return false

  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_UNPOOLED = url
  return true
}
