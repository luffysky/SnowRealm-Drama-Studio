import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobs, approvalRecords, projects, usageLedger } from '@/db/schema'
import { getFxRates } from '@/lib/settings'

/**
 * 每天該看一眼的執行期狀態 (Z161).
 *
 * 從 `scripts/check-runtime-health.ts` 抽出來，因為同一份判斷要在兩個地方
 * 跑：本機那支腳本，以及每日排程打的那支 API。兩份各寫一次的下場今天已經看
 * 過好幾次了——`estimate()` 跟 `run()`、`max-height` 跟 `bottom`、四個元件各
 * 自手刻的 AI 呼叫。
 *
 * 這裡**只讀不寫**。它回報狀態，不替任何人決定要怎麼辦。
 */

/*
 * 門檻值不對外匯出——沒有人用（`check:dead` 在我寫完這支的一小時內就抓到
 * 了）。要讓介面顯示「超過幾天」的時候再匯出，不要先匯出等著。
 */

/** 幾天沒更新就算舊。匯率每天抓，兩天沒動就是排程沒在跑。 */
const FX_STALE_DAYS = 2

/** 一份內容被鎖多久算「忘了解鎖」。 */
const LOCK_STALE_DAYS = 7

/**
 * 卡在「執行中」多久算死的。
 *
 * worker 的 `maxDuration` 是 60 秒，所以超過一小時還在 RUNNING 一定是進程
 * 被砍掉、鎖沒有釋放——它會一直看起來很忙。
 */
const STUCK_HOURS = 1

export type HealthReport = {
  /** 看的是哪一個資料庫。少了這個，本機跑出來的結論會被當成線上的。 */
  database: string
  jobs: {
    failed: number
    queued: number
    running: number
    awaitingReview: number
    stuck: number
    recentFailures: { kind: string; message: string; at: string }[]
  }
  fx: { base: string; asOf: string; source: string; auto: boolean; ageDays: number | null }
  locks: { total: number; stale: number }
  spend: { monthToDateUsd: number; since: string }
  projects: number
  /** 要人處理的。空陣列代表沒事。 */
  problems: string[]
  /** 知道一下就好，不用動手的。 */
  notes: string[]
}

/** 本地日期。台北是 UTC+8，用 `toISOString()` 會把本月一號印成上個月最後一天。 */
function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function databaseLabel(): string {
  const url = process.env.DATABASE_URL ?? ''
  const host = /@([^/:]+)/.exec(url)?.[1] ?? '（讀不出來）'
  return /127\.0\.0\.1|localhost/.test(host) ? `${host}（本機）` : host
}

export async function healthReport(): Promise<HealthReport> {
  const problems: string[] = []
  const notes: string[] = []

  /* ---- AI 佇列 ------------------------------------------------------ */

  const byStatus = await db
    .select({ status: aiJobs.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiJobs)
    .groupBy(aiJobs.status)

  const count = (status: string) => byStatus.find((row) => row.status === status)?.n ?? 0

  const failed = count('FAILED')
  const [stuckRow] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.status, 'RUNNING'),
        sql`${aiJobs.startedAt} < now() - make_interval(hours => ${STUCK_HOURS})`
      )
    )

  const stuck = stuckRow?.n ?? 0

  const recent = failed
    ? await db
        .select({ kind: aiJobs.kind, errorMessage: aiJobs.errorMessage, at: aiJobs.updatedAt })
        .from(aiJobs)
        .where(eq(aiJobs.status, 'FAILED'))
        .orderBy(desc(aiJobs.updatedAt))
        .limit(3)
    : []

  if (failed > 0) problems.push(`${failed} 個 AI 任務是失敗狀態`)
  if (stuck > 0) {
    problems.push(
      `${stuck} 個任務卡在「執行中」超過 ${STUCK_HOURS} 小時——worker 只有 60 秒，那是死的`
    )
  }

  /* ---- 匯率 --------------------------------------------------------- */

  const fx = await getFxRates()
  /*
   * 看 `source` 而不是 `asOf`：內建預設值也有一個 `asOf`，所以只看日期分不出
   * 「今天抓的」跟「內建的那個日期剛好是今天」。
   */
  const auto = fx.source.includes('er-api.com')
  const ageDays = auto ? (Date.now() - new Date(fx.asOf).getTime()) / 86_400_000 : null

  if (!auto) {
    notes.push(`匯率還是內建／手動值（來源：${fx.source}）——自動更新沒有成功過`)
  } else if (ageDays !== null && ageDays > FX_STALE_DAYS) {
    problems.push(`匯率 ${ageDays.toFixed(1)} 天沒更新——每日排程可能沒在跑`)
  }

  /* ---- 定稿鎖 ------------------------------------------------------- */

  const approvals = await db
    .select({
      targetId: approvalRecords.targetId,
      locks: approvalRecords.locks,
      at: approvalRecords.createdAt,
    })
    .from(approvalRecords)
    .where(eq(approvalRecords.targetType, 'DOCUMENT'))
    .orderBy(desc(approvalRecords.createdAt))

  /*
   * 一個 target 只看最新那一筆。解鎖是**新增**一筆 UNLOCKED，不是改舊的，
   * 所以只數 `locks = true` 會把已經解開的也算進來。
   */
  const seen = new Set<string>()
  const current: { at: Date }[] = []
  for (const row of approvals) {
    if (seen.has(row.targetId)) continue
    seen.add(row.targetId)
    if (row.locks) current.push({ at: row.at })
  }

  const staleLocks = current.filter(
    (row) => (Date.now() - row.at.getTime()) / 86_400_000 > LOCK_STALE_DAYS
  ).length

  if (staleLocks > 0) {
    notes.push(`${staleLocks} 份內容鎖住超過 ${LOCK_STALE_DAYS} 天——確認是定稿了，不是忘了解`)
  }

  /* ---- 本月花費 ----------------------------------------------------- */

  const since = new Date()
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const [spendRow] = await db
    .select({ total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)` })
    .from(usageLedger)
    .where(gte(usageLedger.occurredAt, since))

  const [liveProjects] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(projects)
    .where(isNull(projects.deletedAt))

  return {
    database: databaseLabel(),
    jobs: {
      failed,
      queued: count('QUEUED'),
      running: count('RUNNING'),
      awaitingReview: count('AWAITING_REVIEW'),
      stuck,
      recentFailures: recent.map((row) => ({
        kind: row.kind,
        message: (row.errorMessage || '').slice(0, 200),
        at: row.at.toISOString(),
      })),
    },
    fx: { base: fx.base, asOf: fx.asOf, source: fx.source, auto, ageDays },
    locks: { total: current.length, stale: staleLocks },
    spend: { monthToDateUsd: Number(spendRow?.total ?? 0), since: localDate(since) },
    projects: liveProjects?.n ?? 0,
    problems,
    notes,
  }
}
