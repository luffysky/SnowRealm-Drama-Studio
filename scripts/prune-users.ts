/**
 * Removes an obsolete member account by email.
 *
 *   npx tsx scripts/prune-users.ts --email old@example.com            # dry run
 *   npx tsx scripts/prune-users.ts --email old@example.com --apply
 *
 * `db:seed` upserts on email, so changing SEED_*_EMAIL leaves the previous
 * account behind rather than renaming it. This is how that leftover gets
 * cleaned up — deliberately, by name, rather than by a blanket "delete
 * everything not in the env" rule that would be one typo away from wiping a
 * live account.
 *
 * Refuses to touch the two accounts currently named in SEED_*_EMAIL, and
 * refuses to delete anyone still owning or leading a project.
 */
import { loadEnv } from '../src/lib/load-env'

function emails(): string[] {
  const out: string[] = []
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--email') {
      const value = process.argv[i + 1]?.trim().toLowerCase()
      if (value) out.push(value)
    }
  }
  return out
}

async function main(): Promise<void> {
  loadEnv()

  const targets = emails()
  const apply = process.argv.includes('--apply')

  if (targets.length === 0) {
    console.error('用法：npx tsx scripts/prune-users.ts --email <帳號> [--email …] [--apply]')
    process.exit(1)
  }

  const protectedEmails = [process.env.SEED_OWNER_EMAIL, process.env.SEED_COLLABORATOR_EMAIL]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase())

  const collision = targets.filter((email) => protectedEmails.includes(email))
  if (collision.length > 0) {
    console.error(`拒絕刪除目前使用中的帳號：${collision.join(', ')}`)
    process.exit(1)
  }

  const { inArray, or } = await import('drizzle-orm')
  const { db, closeDb } = await import('../src/db')
  const { activities, projects, sessions, users } = await import('../src/db/schema')

  const found = await db
    .select({ id: users.id, email: users.email, account: users.account, name: users.name })
    .from(users)
    .where(inArray(users.email, targets))

  if (found.length === 0) {
    console.log('沒有符合的帳號，無需處理。')
    await closeDb()
    return
  }

  const ids = found.map((row) => row.id)

  const owned = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(or(inArray(projects.ownerId, ids), inArray(projects.techLeadId, ids)))

  const activityRows = await db
    .select({ id: activities.id })
    .from(activities)
    .where(inArray(activities.userId, ids))

  const sessionRows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.userId, ids))

  console.log(`\n將刪除 ${found.length} 筆帳號：`)
  for (const row of found) {
    console.log(`  ${row.email}  ${row.name}（${row.account || '無帳號'}）`)
  }
  console.log(`  連帶：${sessionRows.length} 筆 session、${activityRows.length} 筆活動紀錄`)

  if (owned.length > 0) {
    console.error('\n這些作品仍指向待刪帳號，請先改派負責人：')
    for (const project of owned) console.error(`  ${project.title}`)
    await closeDb()
    process.exit(1)
  }

  if (!apply) {
    console.log('\n（dry run，未變更任何資料。加上 --apply 才會實際刪除）\n')
    await closeDb()
    return
  }

  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(inArray(sessions.userId, ids))
    await tx.delete(users).where(inArray(users.id, ids))
  })

  console.log(`\n已刪除 ${found.length} 筆帳號。\n`)
  await closeDb()
}

void main()
