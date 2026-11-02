/**
 * Removes upload sessions that never completed, and the PENDING asset rows
 * behind them.
 *
 * An upload can be abandoned legitimately — the browser was closed mid-transfer
 * — so this is a maintenance sweep rather than an error path. A COMPLETED asset
 * is never touched, and neither is a row younger than the retention window,
 * so an upload still in flight is safe.
 *
 *   npx tsx scripts/purge-stale-uploads.ts [--hours 24] [--dry-run]
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { closeDb, db } from '../src/db'
import { assets, uploadSessions } from '../src/db/schema'
import { loadEnv } from '../src/lib/load-env'

async function main() {
  loadEnv()

  const hoursArg = process.argv.indexOf('--hours')
  const hours = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 24
  const dryRun = process.argv.includes('--dry-run')
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  const stale = await db
    .select({
      assetId: assets.id,
      name: assets.name,
      objectKey: assets.objectKey,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(eq(assets.uploadStatus, 'PENDING'), lt(assets.createdAt, cutoff)))

  console.log(
    `\n[purge] ${stale.length} PENDING asset(s) older than ${hours}h${dryRun ? ' (dry run)' : ''}\n`
  )

  for (const row of stale) {
    console.log(`  ${row.createdAt.toISOString()}  ${row.name}`)
  }

  if (stale.length === 0 || dryRun) {
    console.log()
    return
  }

  // Cascade removes the upload_sessions rows. The R2 object, if any bytes did
  // land, is left for a separate bucket-side lifecycle rule — this script owns
  // database state only.
  const ids = stale.map((s) => s.assetId)
  await db.delete(assets).where(inArray(assets.id, ids))

  const [remaining] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(uploadSessions)

  console.log(`\n[purge] removed ${stale.length}; ${Number(remaining?.n ?? 0)} upload session(s) remain\n`)
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[purge] failed:', err instanceof Error ? err.message : err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
