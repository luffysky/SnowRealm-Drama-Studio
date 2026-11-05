import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 每天該看一眼的執行期狀態 (Z159).
 *
 * 跟 `check-dead-wiring.ts` 分開，因為它們該在不同時候跑：靜態掃描掃的是
 * 程式碼，程式碼不變它就不會變，所以**每天掃一次會印出一模一樣的東西**，
 * 而每天印同一份清單的工具，第三天就沒有人看了。那支放在提交門檻上。
 *
 * 這一支相反：它看的東西每天都在動，而且**壞掉的時候沒有人會收到通知**——
 * 任務失敗了躺在佇列裡、匯率三天沒更新、有人把一份內容定稿鎖住就忘了。
 * 這幾件的共同點是「系統看起來正常，因為沒有人在看」。
 *
 * 不改任何東西，只報告。有問題時 exit code 1，方便排程把它接去通知。
 */

/** 幾天沒更新就算舊。匯率每天抓，兩天沒動就是 cron 沒在跑。 */
const FX_STALE_DAYS = 2

/** 一份內容被鎖多久算「忘了解鎖」。 */
const LOCK_STALE_DAYS = 7

/**
 * 先說清楚在看哪一個資料庫。
 *
 * 少了這一行，我自己就差點報錯一次：本機資料庫從來沒有被 Vercel 的 cron 打
 * 過，所以「匯率還沒抓過」在這裡是**正常的**，在線上才是故障。一份不說自己
 * 在看哪裡的報告，會讓人對著正常的東西去修。
 */
function whichDatabase(): string {
  const url = process.env.DATABASE_URL ?? ''
  const host = /@([^/:]+)/.exec(url)?.[1] ?? '（讀不出來）'
  const local = /127\.0\.0\.1|localhost/.test(host)
  return `${host}${local ? '　← 本機，不是線上；cron 從來不會打這裡' : ''}`
}

async function main() {
  console.log(`  資料庫：${whichDatabase()}
`)

  const { db } = await import('../src/db')
  const { aiJobs, approvalRecords, projects, usageLedger } = await import('../src/db/schema')
  const { and, desc, eq, gte, isNull, sql } = await import('drizzle-orm')
  const { getFxRates } = await import('../src/lib/settings')

  const problems: string[] = []
  const notes: string[] = []

  /* ---- 1. 失敗或卡住的 AI 任務 ------------------------------------- */

  const jobRows = await db
    .select({ status: aiJobs.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiJobs)
    .groupBy(aiJobs.status)

  const count = (status: string) => jobRows.find((r) => r.status === status)?.n ?? 0

  const failed = count('FAILED')
  const queued = count('QUEUED')
  const running = count('RUNNING')
  const awaiting = count('AWAITING_REVIEW')

  console.log('  ## AI 佇列')
  console.log(
    `  失敗 ${failed}　排隊中 ${queued}　執行中 ${running}　等人確認 ${awaiting}`
  )

  if (failed > 0) {
    const recent = await db
      .select({ kind: aiJobs.kind, errorMessage: aiJobs.errorMessage, at: aiJobs.updatedAt })
      .from(aiJobs)
      .where(eq(aiJobs.status, 'FAILED'))
      .orderBy(desc(aiJobs.updatedAt))
      .limit(3)

    for (const row of recent) {
      console.log(`    ${row.kind}：${(row.errorMessage || '').slice(0, 90)}`)
    }
    problems.push(`${failed} 個 AI 任務是失敗狀態`)
  }

  /*
   * 卡在 RUNNING 的任務最危險：它佔著鎖、看起來忙、而且永遠不會自己好。
   * worker 的 maxDuration 是 60 秒，所以超過一小時還在 RUNNING 一定是死的。
   */
  const stuck = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.status, 'RUNNING'),
        sql`${aiJobs.startedAt} < now() - interval '1 hour'`
      )
    )

  const stuckCount = stuck[0]?.n ?? 0
  if (stuckCount > 0) {
    problems.push(`${stuckCount} 個任務卡在「執行中」超過一小時——worker 只有 60 秒，那是死的`)
  }

  /* ---- 2. 匯率有沒有在更新 ------------------------------------------ */

  console.log('\n  ## 匯率')
  const fx = await getFxRates()

  /*
   * 看 `asOf` 與 `source`，不是 `fetchedAt`——**那個欄位不存在**。
   *
   * 第一版讀了 `fetchedAt`，於是它永遠是 undefined、永遠回報「還沒抓過」，
   * 而我差一點就拿那個去斷定每日排程壞了。這跟今天修掉的預估成本那個 bug
   * 是同一個錯：讀一個不存在的欄位，拿到 undefined，把它當成答案。
   *
   * 分辨真的有沒有自動抓過，靠 `source`：自動更新寫的是來源網域，內建預設
   * 值寫的是「手動輸入（尚未於專案設定更新）」。
   */
  const auto = fx.source.includes('er-api.com')
  console.log(`  ${fx.base}　asOf ${fx.asOf}　來源「${fx.source}」`)

  if (!auto) {
    notes.push(`匯率還是內建／手動值（來源：${fx.source}）——自動更新沒有成功過`)
  } else {
    const days = (Date.now() - new Date(fx.asOf).getTime()) / 86_400_000
    console.log(`  距今 ${days.toFixed(1)} 天`)
    if (days > FX_STALE_DAYS) {
      problems.push(`匯率 ${days.toFixed(1)} 天沒更新——每日排程可能沒在跑`)
    }
  }

  /* ---- 3. 鎖住很久沒解的內容 ---------------------------------------- */

  console.log('\n  ## 定稿鎖')
  const locked = await db
    .select({
      targetId: approvalRecords.targetId,
      at: approvalRecords.createdAt,
      projectId: approvalRecords.projectId,
    })
    .from(approvalRecords)
    .where(and(eq(approvalRecords.locks, true), eq(approvalRecords.state, 'APPROVED')))
    .orderBy(desc(approvalRecords.createdAt))

  /*
   * 一個 target 只看最新那一筆：解鎖是**新增**一筆 UNLOCKED，不是改舊的，
   * 所以只看 `locks = true` 會把已經解開的也算進來。
   */
  const stillLocked: typeof locked = []
  for (const row of locked) {
    const [latest] = await db
      .select({ locks: approvalRecords.locks })
      .from(approvalRecords)
      .where(
        and(
          eq(approvalRecords.targetType, 'DOCUMENT'),
          eq(approvalRecords.targetId, row.targetId)
        )
      )
      .orderBy(desc(approvalRecords.createdAt))
      .limit(1)
    if (latest?.locks) stillLocked.push(row)
  }

  console.log(`  目前鎖住 ${stillLocked.length} 份`)
  const old = stillLocked.filter(
    (row) => (Date.now() - row.at.getTime()) / 86_400_000 > LOCK_STALE_DAYS
  )
  if (old.length > 0) {
    notes.push(`${old.length} 份內容鎖住超過 ${LOCK_STALE_DAYS} 天——確認是定稿了，不是忘了解`)
  }

  /* ---- 4. 這個月花了多少 -------------------------------------------- */

  console.log('\n  ## 本月花費')
  const since = new Date()
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const spend = await db
    .select({ total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)` })
    .from(usageLedger)
    .where(gte(usageLedger.occurredAt, since))

  /*
   * 本地日期，不是 `toISOString()`。台北是 UTC+8，所以本月一號的午夜換成 UTC
   * 會變成上個月最後一天——這一行本來就印著「10-31 起」。我自己在
   * `ai/digest.ts` 裡為這件事寫過一條測試，然後在這支檔案裡又犯了一次。
   */
  const sinceLabel =
    `${since.getFullYear()}-` +
    `${String(since.getMonth() + 1).padStart(2, '0')}-` +
    `${String(since.getDate()).padStart(2, '0')}`
  console.log(`  ${Number(spend[0]?.total ?? 0).toFixed(4)} USD（${sinceLabel} 起）`)

  /* ---- 5. 作品還在不在 ---------------------------------------------- */

  const live = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(projects)
    .where(isNull(projects.deletedAt))
  console.log(`\n  ## 作品\n  ${live[0]?.n ?? 0} 部`)

  /* ---- 報告 ---------------------------------------------------------- */

  console.log('')
  if (problems.length === 0 && notes.length === 0) {
    console.log('  ✓ 沒有需要處理的')
    return
  }

  for (const note of notes) console.log(`  ⚠ ${note}`)
  for (const problem of problems) console.log(`  ✗ ${problem}`)

  if (problems.length > 0) process.exitCode = 1
}

main().then(
  () => {},
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
