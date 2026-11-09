import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { budgets, usageLedger } from '@/db/schema'
import { ApiError } from '@/lib/api'
import { convert, formatMoney, isCurrency, type CurrencyValue } from '@/lib/money'
import { getFxRates } from '@/lib/settings'

/**
 * Consumption ledger and budget enforcement
 * (spec v2 §5 `usage_ledger`, §6.7「費用控制在伺服器端攔截新付費任務；預估與已實際發生費用分開紀錄」).
 *
 * An estimate and an actual charge are separate rows. That matters for the
 * budget check: work already queued has cost nothing yet but is committed, so
 * ignoring estimates would let a burst of jobs blow straight through a cap
 * before any of them settles.
 */

export type UsageRow = typeof usageLedger.$inferSelect

/** `YYYY-MM` for a date, in UTC so the boundary does not drift by timezone. */
export function periodOf(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Records a forecast, before the work runs. */
export async function recordEstimate(input: {
  projectId: string
  episodeId?: string | null
  source: 'AI_JOB' | 'STORAGE' | 'MANUAL'
  refId?: string | null
  description: string
  unit?: string
  quantity?: number
  amountUsd: number
  occurredAt?: Date
}): Promise<UsageRow> {
  const occurredAt = input.occurredAt ?? new Date()

  const [row] = await db
    .insert(usageLedger)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      source: input.source,
      kind: 'ESTIMATE',
      refId: input.refId ?? null,
      description: input.description,
      unit: input.unit ?? '',
      quantity: String(input.quantity ?? 0),
      amount: input.amountUsd.toFixed(6),
      currency: 'USD',
      period: periodOf(occurredAt),
      occurredAt,
    })
    .returning()

  if (!row) throw new Error('Failed to record usage estimate')
  return row
}

/**
 * Records the settled charge. Links back to the estimate it replaces so the
 * two are never double-counted.
 */
export async function recordActual(input: {
  projectId: string
  episodeId?: string | null
  source: 'AI_JOB' | 'STORAGE' | 'MANUAL'
  refId?: string | null
  description: string
  unit?: string
  quantity?: number
  amountUsd: number
  occurredAt?: Date
}): Promise<UsageRow> {
  const occurredAt = input.occurredAt ?? new Date()

  // Find the estimate for this reference, if one was recorded.
  let settlesId: string | null = null
  if (input.refId) {
    const [estimate] = await db
      .select({ id: usageLedger.id })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.source, input.source),
          eq(usageLedger.refId, input.refId),
          eq(usageLedger.kind, 'ESTIMATE')
        )
      )
      .limit(1)
    settlesId = estimate?.id ?? null
  }

  const [row] = await db
    .insert(usageLedger)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      source: input.source,
      kind: 'ACTUAL',
      refId: input.refId ?? null,
      description: input.description,
      unit: input.unit ?? '',
      quantity: String(input.quantity ?? 0),
      amount: input.amountUsd.toFixed(6),
      currency: 'USD',
      period: periodOf(occurredAt),
      settlesId,
      occurredAt,
    })
    .returning()

  if (!row) throw new Error('Failed to record actual usage')
  return row
}

export type SpendSummary = {
  period: string
  /** Settled charges. */
  actualUsd: number
  /** Estimates for work that has not settled yet. */
  committedUsd: number
  /** actual + committed — what a cap must be compared against. */
  totalUsd: number
}

/**
 * Spend for a project in one period.
 *
 * An estimate only counts as committed while no ACTUAL row settles it; once
 * the real charge lands, the estimate is excluded so the two never stack.
 */
export async function spendForPeriod(
  projectId: string,
  period: string = periodOf()
): Promise<SpendSummary> {
  /*
   * Summed per currency, not with a bare `sum(amount)`.
   *
   * Ledger rows carry their own `currency`. Adding them without looking at it
   * treats NT$1 and US$1 as the same number — which is exactly how a cap ends
   * up roughly 30x too loose.
   */
  const actualRows = await db
    .select({
      currency: usageLedger.currency,
      total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)`,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        eq(usageLedger.period, period),
        eq(usageLedger.kind, 'ACTUAL')
      )
    )
    .groupBy(usageLedger.currency)

  // Estimates that no ACTUAL row has settled yet.
  const committedRows = await db
    .select({
      currency: usageLedger.currency,
      total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)`,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        eq(usageLedger.period, period),
        eq(usageLedger.kind, 'ESTIMATE'),
        /*
         * 外層那一欄要**寫死限定名** (Z199)。
         *
         * 內插渲染成不帶表名的 "id"，而子查詢裡 `settling` 就是同一張表、也有
         * `id`——條件變成 `settling.settles_id = settling.id`，永遠不成立，於是
         * `not exists` 永遠為真：**每一筆估算都被算成還沒結算**。成本頁的「已
         * 承諾未結算」因此一直是灌水的，而那個數字看起來完全合理。
         */
        sql`not exists (
          select 1 from ${usageLedger} settling
           where settling.kind = 'ACTUAL'
             and settling.settles_id = usage_ledger.id
        )`
      )
    )
    .groupBy(usageLedger.currency)

  const fx = await getFxRates()

  /** Sums per-currency subtotals into USD, the currency AI costs are quoted in. */
  function toUsd(rows: { currency: string; total: string }[]): number {
    let sum = 0
    for (const row of rows) {
      const amount = Number(row.total)
      if (!amount) continue
      if (!isCurrency(row.currency)) {
        throw new Error(`用量帳本出現不支援的幣別：${row.currency}`)
      }
      sum += convert(amount, row.currency, 'USD', fx)
    }
    return sum
  }

  const actualUsd = toUsd(actualRows)
  const committedUsd = toUsd(committedRows)

  return {
    period,
    actualUsd,
    committedUsd,
    totalUsd: actualUsd + committedUsd,
  }
}

export type BudgetVerdict =
  | { allowed: true; warning?: string; summary: SpendSummary }
  | { allowed: false; reason: string; summary: SpendSummary; capUsd: number }

/**
 * Server-side gate for a new paid task (spec v2 §6.7).
 *
 * Checks the project's cap for this period against settled plus committed
 * spend, including the cost of the job about to be queued. Returns a verdict
 * rather than throwing, so a caller can surface a warning near the cap and a
 * refusal past it.
 */
export async function checkBudget(input: {
  projectId: string
  /** Cost of the task being considered, in USD. */
  additionalUsd: number
  category?: 'AI_API'
  period?: string
}): Promise<BudgetVerdict> {
  const period = input.period ?? periodOf()
  const summary = await spendForPeriod(input.projectId, period)
  const fx = await getFxRates()

  // Most specific cap wins: category+period, then category, then project-wide.
  const caps = await db
    .select({
      amount: budgets.amount,
      currency: budgets.currency,
      category: budgets.category,
      period: budgets.period,
      alertThresholdPct: budgets.alertThresholdPct,
    })
    .from(budgets)
    .where(eq(budgets.projectId, input.projectId))

  const applicable = caps
    .filter(
      (c) =>
        (c.category === null || c.category === (input.category ?? 'AI_API')) &&
        (c.period === null || c.period === period)
    )
    .sort((a, b) => specificity(b) - specificity(a))

  const cap = applicable[0]
  if (!cap) return { allowed: true, summary }

  /*
   * The cap is stored in whatever currency it was entered in (`budgets.currency`
   * defaults to TWD) while AI costs are quoted in USD. Comparing the two raw
   * numbers silently multiplies the cap by the exchange rate.
   */
  const capCurrency: CurrencyValue = isCurrency(cap.currency) ? cap.currency : 'TWD'
  const capAmount = Number(cap.amount)
  const capUsd = convert(capAmount, capCurrency, 'USD', fx)

  /** The cap as entered, plus its USD equivalent when those differ. */
  const capLabel =
    capCurrency === 'USD'
      ? formatMoney(capUsd, 'USD')
      : `${formatMoney(capAmount, capCurrency)}（約 ${formatMoney(capUsd, 'USD')}，匯率日期 ${fx.asOf}）`

  const projected = summary.totalUsd + input.additionalUsd

  if (projected > capUsd) {
    return {
      allowed: false,
      reason:
        `本期（${period}）預算上限為 ${capLabel}，` +
        `目前已發生 US$${summary.actualUsd.toFixed(2)}、已承諾 US$${summary.committedUsd.toFixed(2)}，` +
        `這筆任務預估 US$${input.additionalUsd.toFixed(2)}，合計將超出上限。`,
      summary,
      capUsd,
    }
  }

  const thresholdUsd = (capUsd * cap.alertThresholdPct) / 100
  if (projected >= thresholdUsd) {
    return {
      allowed: true,
      warning:
        `已達本期預算的 ${Math.round((projected / capUsd) * 100)}%` +
        `（US$${projected.toFixed(2)} / US$${capUsd.toFixed(2)}）。`,
      summary,
    }
  }

  return { allowed: true, summary }
}

function specificity(cap: { category: unknown; period: unknown }): number {
  return (cap.category === null ? 0 : 1) + (cap.period === null ? 0 : 2)
}

/** Throws 403 when a budget refuses the task. */
export async function assertWithinBudget(input: {
  projectId: string
  additionalUsd: number
  category?: 'AI_API'
}): Promise<{ warning?: string }> {
  const verdict = await checkBudget(input)

  if (!verdict.allowed) {
    throw new ApiError(403, verdict.reason, 'budget_exceeded', {
      capUsd: verdict.capUsd,
      actualUsd: verdict.summary.actualUsd,
      committedUsd: verdict.summary.committedUsd,
    })
  }

  return verdict.warning ? { warning: verdict.warning } : {}
}
