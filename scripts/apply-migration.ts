/**
 * 跑還沒跑過的遷移，跑過的跳過——而**跑過的那一支被改掉時要叫**。
 *
 *     npm run db:apply                 # 把還沒跑的跑掉（正式庫）
 *     npm run db:apply -- --test       # 同上，但對本機測試庫
 *     npm run db:apply -- --dry        # 只說會跑哪幾支，不真的跑
 *     npm run db:apply -- --baseline 0036
 *                                      # 認列 0000–0036 已經跑過（不執行）
 *     npm run db:apply -- --accept 0012
 *                                      # 那一支的內容改了而且我確定不用重跑
 *     npm run db:apply drizzle/00XX.sql
 *                                      # 只跑指定那一支（會記進帳）
 *
 * ## 為什麼不是 `drizzle-kit migrate`
 *
 * `drizzle/meta/_journal.json` **只記到 0015**。0016 之後那二十幾支是手寫的
 * （drizzle-kit 的產生器需要 TTY 來問改名，見 `db-verify.ts` 的檔頭），從來沒
 * 進過 journal——而 `drizzle-kit migrate` 只跑 journal 裡有的。所以它不但不會
 * 跑新的那一支，在一座**新**資料庫上還會安靜地少建二十幾支的東西。
 *
 * 這一支不看 journal，直接看 `drizzle/*.sql`。
 *
 * ## 帳記在哪裡
 *
 * `public.applied_migrations`，**不是** drizzle 的
 * `drizzle.__drizzle_migrations`。兩本帳分開，是因為哪天 journal 修好了、有人
 * 跑 `drizzle-kit migrate`，它會用自己的雜湊規則讀自己那張表——在那張表裡塞我
 * 們自己算的雜湊，只會讓它做出看起來合理但是錯的決定。
 *
 * ## 「跑過的那一支被改掉」要怎麼辦
 *
 * **叫，然後停下來。** 不自動重跑：一支已經套用過的遷移再跑一次，輕則報錯，
 * 重則把資料弄壞（想像一支 `UPDATE … SET x = x * 2`）。真的只是改了註解的
 * 話，用 `--accept <tag>` 把帳上的雜湊更新掉。
 *
 * 雜湊**先把換行統一成 `\n` 再算**。這個 repo 在 Windows 上會被 git 轉成
 * CRLF，不統一的話同一個檔案在兩台機器上會算出兩個雜湊，然後每次都在喊「這
 * 支被改過了」——喊久了就沒有人看了。
 *
 * ## 不包交易
 *
 * 有些 DDL（`ALTER TYPE … ADD VALUE`）在交易裡跑不起來，包進去會讓一支本來能
 * 用的遷移在這裡失敗。代價是中途失敗會留下半套——所以遷移本身要寫成可以重跑
 * 的（`IF NOT EXISTS`、`ON CONFLICT DO NOTHING`、`EXCEPTION WHEN
 * duplicate_object`）。失敗的那一支**不會**被記進帳，所以修好之後再跑一次就
 * 會從它開始。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { loadEnv } from '../src/lib/load-env'

const DIR = 'drizzle'

const LEDGER = `
  create table if not exists public.applied_migrations (
    tag text primary key,
    checksum text not null,
    applied_at timestamptz not null default now(),
    /* 認列進來的（--baseline），不是這支腳本真的跑過的。 */
    adopted boolean not null default false
  )
`

type Migration = { tag: string; file: string; checksum: string }

/** 換行統一成 \n 再算，不然 Windows 的 CRLF 會讓同一個檔案算出兩個雜湊。 */
function checksumOf(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n').trimEnd()).digest('hex').slice(0, 16)
}

function readMigrations(): Migration[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      tag: name.replace(/\.sql$/, ''),
      file: join(DIR, name),
      checksum: checksumOf(readFileSync(join(DIR, name), 'utf8')),
    }))
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

async function main() {
  loadEnv()

  const args = process.argv.slice(2)
  const useTest = args.includes('--test')
  const dry = args.includes('--dry')
  const baseline = arg('baseline')
  const accept = arg('accept')
  const single = args.find((a) => a.endsWith('.sql'))

  const url = useTest
    ? process.env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
  if (!url) {
    console.error(useTest ? '沒有 TEST_DATABASE_URL' : '沒有 DATABASE_URL')
    process.exit(2)
  }

  /*
   * 印出主機，不印出密碼。
   *
   * 「我剛剛是不是套到正式庫去了」這個問題，事後查比事前看一眼貴得多。
   */
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return '（讀不出主機）'
    }
  })()
  console.log(`\n  目標：${host}${useTest ? '（測試庫）' : '（正式庫）'}`)

  const all = readMigrations()
  const client = new Client({ connectionString: url })
  await client.connect()

  try {
    await client.query(LEDGER)

    const { rows } = await client.query<{ tag: string; checksum: string }>(
      'select tag, checksum from public.applied_migrations'
    )
    const applied = new Map(rows.map((row) => [row.tag, row.checksum]))

    /* ---- --accept ---------------------------------------------------- */
    if (accept) {
      const found = all.find((m) => m.tag === accept || m.tag.startsWith(`${accept}_`))
      if (!found) {
        console.error(`\n  找不到 ${accept}\n`)
        process.exit(1)
      }
      await client.query(
        'update public.applied_migrations set checksum = $1 where tag = $2',
        [found.checksum, found.tag]
      )
      console.log(`\n  ${found.tag} 的內容已更新到帳上（沒有重跑）。\n`)
      return
    }

    /* ---- --baseline -------------------------------------------------- */
    if (baseline) {
      const cutoff = all.findIndex((m) => m.tag === baseline || m.tag.startsWith(`${baseline}_`))
      if (cutoff === -1) {
        console.error(`\n  找不到 ${baseline}\n`)
        process.exit(1)
      }
      const adopt = all.slice(0, cutoff + 1)
      console.log(`\n  認列 ${adopt.length} 支為「已跑過」（不執行）：`)
      for (const migration of adopt) {
        if (!dry) {
          await client.query(
            `insert into public.applied_migrations (tag, checksum, adopted) values ($1, $2, true)
             on conflict (tag) do update set checksum = excluded.checksum`,
            [migration.tag, migration.checksum]
          )
        }
        console.log(`    ${applied.has(migration.tag) ? '已在帳上' : '認列'}  ${migration.tag}`)
      }
      console.log(dry ? '\n  （--dry，什麼都沒寫）\n' : '\n  認列完成。\n')
      return
    }

    /* ---- 內容被改過的 ------------------------------------------------ */
    const changed = all.filter((m) => applied.has(m.tag) && applied.get(m.tag) !== m.checksum)
    if (changed.length > 0) {
      console.error(`\n  ✗ ${changed.length} 支已經跑過的遷移，檔案內容被改過：\n`)
      for (const migration of changed) {
        console.error(`      ${migration.tag}`)
      }
      console.error(
        '\n  已經套用過的遷移再跑一次，輕則報錯、重則把資料弄壞，所以這裡停下來。\n' +
          '  真的只是改了註解的話：npm run db:apply -- --accept <tag>\n' +
          '  真的需要改結構的話：另外開一支新的遷移。\n'
      )
      process.exit(1)
    }

    /* ---- 要跑哪幾支 -------------------------------------------------- */
    const pending = single
      ? all.filter((m) => m.file === single.replace(/\\/g, '/') || m.file === single)
      : all.filter((m) => !applied.has(m.tag))

    if (single && pending.length === 0) {
      console.error(`\n  找不到 ${single}\n`)
      process.exit(1)
    }

    if (pending.length === 0) {
      console.log(`  全部 ${all.length} 支都跑過了，沒有要跑的。\n`)
      return
    }

    console.log(`  跑過 ${applied.size} 支，這次要跑 ${pending.length} 支：\n`)
    for (const migration of pending) console.log(`    ${migration.tag}`)

    if (dry) {
      console.log('\n  （--dry，什麼都沒跑）\n')
      return
    }

    console.log('')
    for (const migration of pending) {
      console.log(`  ── ${migration.tag}`)
      const chunks = readFileSync(migration.file, 'utf8')
        .split('--> statement-breakpoint')
        .map((chunk) => chunk.trim())
        .filter(Boolean)

      for (const [index, statement] of chunks.entries()) {
        const head = statement.replace(/\s+/g, ' ').slice(0, 64)
        process.stdout.write(`     ${index + 1}/${chunks.length}  ${head}… `)
        await client.query(statement)
        console.log('ok')
      }

      /*
       * 記帳在**整支跑完之後**。
       *
       * 中途失敗的那一支不會被記進去，所以修好之後再跑一次會從它開始，而不是
       * 以為它已經過了然後從下一支開始——那會留下一個誰都查不出來的半套結構。
       */
      await client.query(
        `insert into public.applied_migrations (tag, checksum) values ($1, $2)
         on conflict (tag) do update set checksum = excluded.checksum, applied_at = now()`,
        [migration.tag, migration.checksum]
      )
    }

    console.log(`\n  ${pending.length} 支都套好了。\n`)
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(`\n  失敗：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
