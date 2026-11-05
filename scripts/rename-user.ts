import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 林鍶恩 改名成 Luffy（同一個人）。
 *
 * `activities.user_name` 是**反正規化**存的——schema 的註解寫明了理由：
 * 「so the feed still reads correctly if a user row changes」。那個設計是
 * 對的，但副作用就是改名之後舊紀錄還是舊名字。
 *
 * 所以這支只改動態列裡的顯示名，不碰 users 表（那裡已經是 Luffy 了）。
 */
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')

  const before = await db.execute(sql.raw(`
    select user_name, count(*)::int as n, count(distinct user_id)::int as ids
      from activities group by user_name order by count(*) desc
  `))
  console.log('  改之前：')
  for (const r of before.rows as Record<string, unknown>[]) {
    console.log(`    ${String(r.user_name || '(空)').padEnd(10)} ${String(r.n).padStart(4)} 筆  ${r.ids} 個 user_id`)
  }

  const users = await db.execute(sql.raw(`select name, email from users order by created_at`))
  console.log('\n  使用者表：')
  for (const r of users.rows as Record<string, unknown>[]) console.log(`    ${r.name}  ${r.email}`)

  const updated = await db.execute(sql.raw(
    `update activities set user_name = 'Luffy' where user_name = '林鍶恩'`
  ))
  console.log(`\n  改了 ${updated.rowCount ?? 0} 筆`)

  const after = await db.execute(sql.raw(`
    select user_name, count(*)::int as n from activities group by user_name order by count(*) desc
  `))
  console.log('\n  改之後：')
  for (const r of after.rows as Record<string, unknown>[]) {
    console.log(`    ${String(r.user_name || '(空)').padEnd(10)} ${String(r.n).padStart(4)} 筆`)
  }

  process.exit(0)
}

void main()
