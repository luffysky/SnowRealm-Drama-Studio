import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { budgets, episodes, expenses, projects, users } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategoryValue } from '@/lib/constants'
import { BASE_CURRENCY, convert, formatMoney, isCurrency, type CurrencyValue } from '@/lib/money'
import { getFxRates } from '@/lib/settings'

/**
 * 手動記一筆帳，以及設一個預算上限 (Z197).
 *
 * ## 為什麼這個檔案是新的
 *
 * `expenses` 原本只有兩個寫入點：AI 任務自己記帳，以及匯入 CSV。介面上**沒有
 * 任何地方**可以記一筆——而成本頁的空狀態寫著「排一個 AI 任務**或記一筆支出**
 * 之後，這裡就會有數字」，「手動記錄（外包、授權、軟體）」那一格也一直在那裡。
 * 叫人做一件做不到的事。
 *
 * `budgets` 更徹底：三個地方讀它，**零個地方寫它**。於是
 * `assertWithinBudget` 每一次都回「沒有上限，放行」——規格 §6.7 的「超支擋下
 * 任務」是一個裝飾品，而成本頁的預算區永遠顯示「還沒有設定任何預算上限」，旁
 * 邊沒有任何可以設定它的地方。
 *
 * ## 匯率在記帳當下就定下來
 *
 * `expenses` 有 `exchange_rate` 與 `base_currency` 兩欄，而它們存在的理由就是
 * 這個：今天用 1 美元 32 台幣記的帳，明年匯率變了也還是那一天的事實。用當下
 * 的匯率去算歷史的帳，是把一個推論寫成事實。
 */

export type ExpenseInput = {
  projectId: string
  episodeId?: string | null
  category?: ExpenseCategoryValue
  description: string
  /** 字串，不是數字：小數位不能讓 float 去湊。 */
  amount: string
  currency: string
  spentAt?: Date
  vendor?: string
  paidById?: string | null
  note?: string
}

export async function addExpense(
  input: ExpenseInput,
  user: SessionUser
): Promise<{ id: string }> {
  const currency = requireCurrency(input.currency)
  await assertProject(input.projectId)
  if (input.episodeId) await assertEpisodeInProject(input.projectId, input.episodeId)
  if (input.paidById) await assertUser(input.paidById)

  /*
   * 匯率在這裡算一次就存下來。
   *
   * `convert(1, …)` 回的是「一單位 `currency` 等於幾單位基準幣別」，也就是
   * `exchange_rate` 這一欄要的東西。查不到匯率的話 `convert` 會丟——而那比
   * 悄悄存一個 1 好：存了 1 的話這筆帳在報表上會變成另一個金額。
   */
  const fx = await getFxRates()
  const exchangeRate = convert(1, currency, BASE_CURRENCY, fx)

  const [row] = await db
    .insert(expenses)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      category: input.category ?? 'OTHER',
      description: input.description,
      amount: input.amount,
      currency,
      exchangeRate: String(exchangeRate),
      baseCurrency: BASE_CURRENCY,
      ...(input.spentAt ? { spentAt: input.spentAt } : {}),
      vendor: input.vendor ?? '',
      paidById: input.paidById ?? user.id,
      note: input.note ?? '',
      createdById: user.id,
    })
    .returning({ id: expenses.id })

  if (!row) throw new ApiError(500, '記帳失敗', 'expense_create_failed')

  await logActivity({
    user,
    action: 'create',
    entityType: 'expense',
    entityId: row.id,
    projectId: input.projectId,
    summary:
      `${user.name} 記了一筆${EXPENSE_CATEGORY_LABEL[input.category ?? 'OTHER']}支出：` +
      `${input.description}（${formatMoney(Number(input.amount), currency)}）`,
  })

  return row
}

export type BudgetInput = {
  projectId: string
  /** Null 是「整個作品不分類別」。 */
  category?: ExpenseCategoryValue | null
  /** Null 是「不分期間」，否則 `YYYY-MM`。 */
  period?: string | null
  amount: string
  currency: string
  alertThresholdPct?: number
}

/**
 * 設一個預算上限。同一個範圍已經有了就改掉它。
 *
 * **設下去是有後果的**：`assertWithinBudget` 會開始擋 AI 任務。所以呼叫端要把
 * 這件事寫在表單上，而不是讓人隔天才發現任務跑不動。
 */
export async function upsertBudget(
  input: BudgetInput,
  user: SessionUser
): Promise<{ id: string }> {
  const currency = requireCurrency(input.currency)
  await assertProject(input.projectId)

  const period = input.period?.trim() || null
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw ApiError.badRequest('期間要寫成 YYYY-MM')
  }

  const category = input.category ?? null
  const threshold = input.alertThresholdPct ?? 80

  /*
   * `budgets_scope_key` 是 `(project_id, category, period)` 上的 unique，而
   * **Postgres 的 unique 把 NULL 當成互不相等**——所以「整個作品」那一筆
   * （兩欄都是 null）靠 `onConflict` 是去重不了的，一設再設會長出好幾列而且
   * 每一列都合法。所以先查再決定插還是改。
   */
  const [existing] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.projectId, input.projectId),
        category === null ? isNull(budgets.category) : eq(budgets.category, category),
        period === null ? isNull(budgets.period) : eq(budgets.period, period)
      )
    )
    .limit(1)

  const scope =
    (category ? EXPENSE_CATEGORY_LABEL[category] : '全部類別') + (period ? `・${period}` : '')

  if (existing) {
    await db
      .update(budgets)
      .set({
        amount: input.amount,
        currency,
        alertThresholdPct: threshold,
        updatedAt: new Date(),
      })
      .where(eq(budgets.id, existing.id))

    await logActivity({
      user,
      action: 'update',
      entityType: 'budget',
      entityId: existing.id,
      projectId: input.projectId,
      summary: `${user.name} 把「${scope}」的預算上限改成 ${formatMoney(Number(input.amount), currency)}`,
    })
    return existing
  }

  const [row] = await db
    .insert(budgets)
    .values({
      projectId: input.projectId,
      category,
      period,
      amount: input.amount,
      currency,
      alertThresholdPct: threshold,
    })
    .returning({ id: budgets.id })

  if (!row) throw new ApiError(500, '設定預算失敗', 'budget_create_failed')

  await logActivity({
    user,
    action: 'create',
    entityType: 'budget',
    entityId: row.id,
    projectId: input.projectId,
    summary: `${user.name} 設了「${scope}」的預算上限 ${formatMoney(Number(input.amount), currency)}`,
  })

  return row
}

/**
 * 移除一個預算上限。
 *
 * `projectId` 要一起傳進來，而且**要比對**：`budgetId` 是從網址來的，而路由上
 * 的權限檢查只證明這個人進得了那個作品，不證明他給的那個預算也是那個作品的。
 * 少了這一行，任何進得了任一部作品的人都可以把別部作品的預算上限拆掉——而拆
 * 掉的後果是那邊的 AI 花費從此不再被擋。
 */
export async function deleteBudget(
  projectId: string,
  budgetId: string,
  user: SessionUser
): Promise<void> {
  const [row] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.projectId, projectId)))
    .limit(1)
  if (!row) throw ApiError.notFound('找不到這個預算')

  await db.delete(budgets).where(eq(budgets.id, budgetId))

  await logActivity({
    user,
    action: 'delete',
    entityType: 'budget',
    entityId: budgetId,
    projectId,
    summary: `${user.name} 移除了一個預算上限`,
  })
}

/* -------------------------------------------------------------------------- */

function requireCurrency(value: string): CurrencyValue {
  const upper = (value || '').trim().toUpperCase()
  if (!isCurrency(upper)) throw ApiError.badRequest(`不支援的幣別：${value}`)
  return upper
}

async function assertProject(projectId: string): Promise<void> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!row) throw ApiError.notFound('找不到這個作品')
}

/**
 * 這一集真的是這個作品的嗎。
 *
 * `episodeId` 是從請求本體來的，而外鍵只保證那一集存在——不保證它屬於這個作
 * 品。少了這一段，一筆帳可以掛到別部作品的集數上，而成本頁會照著那一集的作品
 * 去分組。
 */
async function assertEpisodeInProject(projectId: string, episodeId: string): Promise<void> {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
    .limit(1)
  if (!row) throw ApiError.badRequest('指定的集數不屬於這個作品')
}

async function assertUser(userId: string): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!row) throw ApiError.notFound('找不到這個成員')
}
