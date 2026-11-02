import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { budgets, usageLedger } from '@/db/schema'
import { ApiError } from '@/lib/api'

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
  const [actualRow] = await db
    .select({ total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        eq(usageLedger.period, period),
        eq(usageLedger.kind, 'ACTUAL')
      )
    )

  // Estimates that no ACTUAL row has settled yet.
  const [committedRow] = await db
    .select({ total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        eq(usageLedger.period, period),
        eq(usageLedger.kind, 'ESTIMATE'),
        sql`not exists (
          select 1 from ${usageLedger} settling
           where settling.kind = 'ACTUAL'
             and settling.settles_id = ${usageLedger.id}
        )`
      )
    )

  const actualUsd = Number(actualRow?.total ?? 0)
  const committedUsd = Number(committedRow?.total ?? 0)

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

  // Most specific cap wins: category+period, then category, then project-wide.
  const caps = await db
    .select({
      amount: budgets.amount,
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

  const capUsd = Number(cap.amount)
  const projected = summary.totalUsd + input.additionalUsd

  if (projected > capUsd) {
    return {
      allowed: false,
      reason:
        `本期（${period}）預算上限為 US$${capUsd.toFixed(2)}，` +
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
