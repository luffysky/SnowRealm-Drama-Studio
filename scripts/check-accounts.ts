/**
 * Verifies the two studio accounts can actually authenticate against whatever
 * DATABASE_URL points at, without printing or logging any plaintext.
 *
 *   npx tsx scripts/check-accounts.ts
 */
import { loadEnv } from '../src/lib/load-env'

async function main(): Promise<void> {
  loadEnv()

  const { db, closeDb } = await import('../src/db')
  const { users } = await import('../src/db/schema')
  const { algorithmOf, parseArgonParams, verifyPassword } = await import(
    '../src/lib/auth/password'
  )

  const expected: Record<string, string | undefined> = {
    [(process.env.SEED_OWNER_EMAIL ?? '').toLowerCase()]: process.env.SEED_OWNER_PASSWORD,
    [(process.env.SEED_COLLABORATOR_EMAIL ?? '').toLowerCase()]:
      process.env.SEED_COLLABORATOR_PASSWORD,
  }

  const rows = await db
    .select({
      email: users.email,
      account: users.account,
      name: users.name,
      title: users.title,
      role: users.role,
      active: users.active,
      passwordHash: users.passwordHash,
    })
    .from(users)

  console.log(`\n[accounts] ${rows.length} 筆\n`)
  let failures = 0

  for (const row of rows) {
    const algorithm = algorithmOf(row.passwordHash)
    const params = parseArgonParams(row.passwordHash)
    const plaintext = expected[row.email.toLowerCase()]

    const accepts = plaintext ? await verifyPassword(plaintext, row.passwordHash) : null
    // A hash that accepts anything is worse than one that accepts nothing.
    const rejectsWrong = !(await verifyPassword('not-the-password-0000', row.passwordHash))

    if (algorithm !== 'argon2id' || accepts === false || !rejectsWrong || !row.account) {
      failures += 1
    }

    console.log(`  ${row.account || '(未設定帳號)'}  /  ${row.email}`)
    console.log(`    ${row.name}（${row.title}） role=${row.role} active=${row.active}`)
    console.log(
      `    hash=${algorithm} m=${params?.memoryCost} t=${params?.timeCost} p=${params?.parallelism}`
    )
    console.log(
      `    驗證=${accepts === null ? '（env 未提供此帳號密碼，略過）' : accepts ? '通過' : '失敗'}` +
        `  拒絕錯誤密碼=${rejectsWrong ? '是' : '否'}`
    )
  }

  await closeDb()

  if (failures > 0) {
    console.error(`\n[accounts] ${failures} 筆有問題\n`)
    process.exit(1)
  }
  console.log('\n[accounts] 全部正常\n')
}

void main()
