/**
 * Changes a studio account's password — and optionally its email — without
 * re-running the seed.
 *
 * The seed upserts on `email`, so editing SEED_*_EMAIL and re-seeding would
 * create a *second* account rather than rename the existing one. This script
 * updates the row in place instead.
 *
 * The new password is read from stdin, never from argv, so it does not land in
 * shell history or in the process list:
 *
 *   npm run account:password -- --email owner@snowrealm.local
 *   npm run account:password -- --email owner@snowrealm.local --new-email me@example.com
 *
 * Every session for that account is revoked afterwards: a password change must
 * log out whoever was holding the old one.
 */
import { createInterface } from 'node:readline'
import { loadEnv } from '../src/lib/load-env'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]?.trim()
}

/** Reads one line from stdin. Works both piped and typed. */
function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function main(): Promise<void> {
  loadEnv()

  const identifier = arg('email')?.toLowerCase()
  if (!identifier) {
    console.error(
      '用法：npm run account:password -- --email <帳號或 Email> [--new-email <新 Email>]'
    )
    process.exit(1)
  }
  const newEmail = arg('new-email')?.toLowerCase()

  const { and, eq, isNull, or, sql } = await import('drizzle-orm')
  const { db, closeDb } = await import('../src/db')
  const { sessions, users } = await import('../src/db/schema')
  const { describePasswordProblem, hashPassword } = await import('../src/lib/auth/password')

  // Matches the login route: handle or email, case-insensitive.
  const [existing] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      or(
        eq(sql`lower(${users.email})`, identifier),
        and(sql`${users.account} <> ''`, eq(sql`lower(${users.account})`, identifier))
      )
    )
    .limit(1)

  if (!existing) {
    console.error(`找不到帳號 ${identifier}`)
    await closeDb()
    process.exit(1)
  }

  const password = await readLine(`${existing.name}（${existing.email}）的新密碼：`)
  const problem = describePasswordProblem(password)
  if (problem) {
    console.error(problem)
    await closeDb()
    process.exit(1)
  }

  const confirm = await readLine('再輸入一次確認：')
  if (confirm !== password) {
    console.error('兩次輸入不一致，未做任何變更')
    await closeDb()
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        ...(newEmail ? { email: newEmail } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))

    // Old cookies must stop working the moment the password changes.
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, existing.id), isNull(sessions.revokedAt)))
  })

  await closeDb()
  console.log(
    `已更新 ${newEmail ?? existing.email} 的密碼（Argon2id），並撤銷該帳號所有既有 session。`
  )
  console.log('記得同步更新 .env.local 的 SEED_* 值，否則下次 db:seed 會把密碼改回舊的。')
}

void main()
