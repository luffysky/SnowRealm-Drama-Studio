import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { budgets, expenses, projects, usageLedger, users } from '@/db/schema'
import { convert, type CurrencyValue, type FxRates } from '@/lib/money'

/**
 * 成本中心 (Z90).
 *
 * 側邊欄上掛著這一項、標著 M3，但 `/costs` 這個畫面從來沒有做出來——而三張
 * 資料表（`expenses`、`budgets`、`usage_ledger`）早就在收資料了：現在是
 * 7 筆支出、20 筆用量、11 個 AI 任務。
 *
 * ## 這裡最容易算錯的一件事
 *
 * `usage_ledger` 的每一筆花費會**躺兩列**：排隊的時候寫一列 ESTIMATE，結算
 * 的時候寫一列 ACTUAL，用 `settles_id` 指回去。這是故意的，因為「已經排下去
 * 但還沒結算」是一個真的要看的數字。
 *
 * 但也因此，**直接 `sum(amount)` 會把同一筆錢算兩次**。現在的資料剛好是
 * 11 筆估算加 9 筆結算，加總是 $2.2，而實際只花了 $1.1——差一倍，而且兩個
 * 數字都「看起來合理」。
 *
 * 所以：
 *
 *     已實際發生 = 所有 ACTUAL
 *     已承諾未結算 = 沒有被任何 ACTUAL 指到的 ESTIMATE
 *
 * ## 幣別
 *
 * 用量帳是美金（AI 跟儲存都以美金計價），手動支出是當初輸入的幣別，而且
 * 每一筆都存了當時的匯率。**轉換只在顯示時做，不寫回去**——這是規格 23
 * 要求的「保留原始幣別與匯率，金額不可虛構」。
 */

export type CostTotals = {
  /** 已經結算、確定花掉的。 */
  actual: number
  /** 排下去了但還沒結算的。 */
  committed: number
  /** 手動記的支出（外包、授權、軟體⋯）。 */
  manual: number
  /** 以上三者的總和。 */
  total: number
  currency: CurrencyValue
}

export type CostByGroup = {
  key: string
  label: string
  actual: number
  committed: number
  manual: number
}

export type BudgetStatus = {
  id: string
  /** 移除那一列要用它組網址 (Z197)。 */
  projectId: string
  projectTitle: string
  category: string | null
  period: string | null
  cap: number
  spent: number
  /** 0–100 以上；超過 100 就是超支。 */
  usedPct: number
  alertThresholdPct: number
  state: 'ok' | 'warn' | 'over'
}

export type CostLine = {
  id: string
  when: Date
  projectTitle: string
  what: string
  amount: number
  currency: string
  /** `AI_JOB` / `STORAGE` / `MANUAL`，或支出的分類。 */
  source: string
  /** 估算還是實際。手動支出一律是實際。 */
  settled: boolean
}

export type CostOverview = {
  totals: CostTotals
  byProject: CostByGroup[]
  byMonth: CostByGroup[]
  budgets: BudgetStatus[]
  recent: CostLine[]
  /** 有沒有任何一筆資料——決定畫面要講什麼。 */
  hasData: boolean
}

/* -------------------------------------------------------------------------- */
/* 估算與結算                                                                  */
/* -------------------------------------------------------------------------- */

export type LedgerRow = {
  id: string
  kind: 'ESTIMATE' | 'ACTUAL'
  settlesId: string | null
  amount: number
}

/**
 * 把用量帳分成「已實際發生」與「已承諾未結算」。
 *
 * 抽成純函式，因為這是整個成本中心唯一一個**算錯也看起來合理**的地方：
 * 多算一倍的總額跟正確的總額，在畫面上長得一模一樣，只有對帳的時候才會
 * 發現。
 */
export function splitLedger(rows: LedgerRow[]): { actual: number; committed: number } {
  /** 被結算掉的估算。 */
  const settled = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'ACTUAL' && row.settlesId) settled.add(row.settlesId)
  }

  let actual = 0
  let committed = 0

  for (const row of rows) {
    if (row.kind === 'ACTUAL') {
      actual += row.amount
      continue
    }
    // 還沒有人結算它，才算「已承諾」。
    if (!settled.has(row.id)) committed += row.amount
  }

  return { actual, committed }
}

/** `2026-11-05` → `2026-11`，給按月分組用。 */
export function periodOf(when: Date): string {
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`
}

/** 用掉多少算警戒、多少算超支。 */
export function budgetState(usedPct: number, threshold: number): BudgetStatus['state'] {
  if (usedPct >= 100) return 'over'
  return usedPct >= threshold ? 'warn' : 'ok'
}

/* -------------------------------------------------------------------------- */
/* 查詢                                                                        */
/* -------------------------------------------------------------------------- */

export async function costOverview(input: {
  currency: CurrencyValue
  fx: FxRates
  /** 最近幾筆明細。 */
  limit?: number
}): Promise<CostOverview> {
  const { currency, fx } = input
  const limit = input.limit ?? 40

  const [ledgerRows, expenseRows, budgetRows] = await Promise.all([
    db
      .select({
        id: usageLedger.id,
        projectId: usageLedger.projectId,
        projectTitle: projects.title,
        kind: usageLedger.kind,
        source: usageLedger.source,
        settlesId: usageLedger.settlesId,
        amount: usageLedger.amount,
        currency: usageLedger.currency,
        description: usageLedger.description,
        period: usageLedger.period,
        occurredAt: usageLedger.occurredAt,
      })
      .from(usageLedger)
      .innerJoin(projects, eq(projects.id, usageLedger.projectId))
      .where(isNull(projects.deletedAt)),

    db
      .select({
        id: expenses.id,
        projectId: expenses.projectId,
        projectTitle: projects.title,
        category: expenses.category,
        description: expenses.description,
        amount: expenses.amount,
        currency: expenses.currency,
        spentAt: expenses.spentAt,
        vendor: expenses.vendor,
        paidBy: users.name,
      })
      .from(expenses)
      .innerJoin(projects, eq(projects.id, expenses.projectId))
      .leftJoin(users, eq(users.id, expenses.paidById))
      .where(isNull(projects.deletedAt)),

    db
      .select({
        id: budgets.id,
        projectId: budgets.projectId,
        projectTitle: projects.title,
        category: budgets.category,
        period: budgets.period,
        amount: budgets.amount,
        currency: budgets.currency,
        alertThresholdPct: budgets.alertThresholdPct,
      })
      .from(budgets)
      .innerJoin(projects, eq(projects.id, budgets.projectId))
      .where(isNull(projects.deletedAt)),
  ])

  /** 一筆帳換算到要顯示的幣別。 */
  const inDisplay = (amount: string | number, from: string): number =>
    convert(Number(amount) || 0, (from || 'USD') as CurrencyValue, currency, fx)

  /* ---- 總額 ---- */

  const split = splitLedger(
    ledgerRows.map((row) => ({
      id: row.id,
      kind: row.kind as 'ESTIMATE' | 'ACTUAL',
      settlesId: row.settlesId,
      amount: inDisplay(row.amount, row.currency),
    }))
  )

  const manual = expenseRows.reduce(
    (total, row) => total + inDisplay(row.amount, row.currency),
    0
  )

  const totals: CostTotals = {
    actual: split.actual,
    committed: split.committed,
    manual,
    total: split.actual + split.committed + manual,
    currency,
  }

  /* ---- 分組 ---- */

  const group = (keyOf: (row: { projectId: string; projectTitle: string; when: Date }) => {
    key: string
    label: string
  }): CostByGroup[] => {
    const map = new Map<string, CostByGroup>()

    const bucket = (key: string, label: string): CostByGroup => {
      const found = map.get(key) ?? { key, label, actual: 0, committed: 0, manual: 0 }
      map.set(key, found)
      return found
    }

    // 用量帳要先分出估算與結算，再分組——否則又會雙重計算。
    const settled = new Set(
      ledgerRows.filter((row) => row.kind === 'ACTUAL' && row.settlesId).map((row) => row.settlesId!)
    )

    for (const row of ledgerRows) {
      const { key, label } = keyOf({
        projectId: row.projectId,
        projectTitle: row.projectTitle,
        when: row.occurredAt,
      })
      const amount = inDisplay(row.amount, row.currency)

      if (row.kind === 'ACTUAL') bucket(key, label).actual += amount
      else if (!settled.has(row.id)) bucket(key, label).committed += amount
    }

    for (const row of expenseRows) {
      const { key, label } = keyOf({
        projectId: row.projectId,
        projectTitle: row.projectTitle,
        when: row.spentAt,
      })
      bucket(key, label).manual += inDisplay(row.amount, row.currency)
    }

    return [...map.values()].sort(
      (a, b) => b.actual + b.committed + b.manual - (a.actual + a.committed + a.manual)
    )
  }

  const byProject = group((row) => ({ key: row.projectId, label: row.projectTitle }))
  const byMonth = group((row) => {
    const period = periodOf(row.when)
    return { key: period, label: period }
  }).sort((a, b) => b.key.localeCompare(a.key))

  /* ---- 預算 ---- */

  /** 被結算掉的估算，算一次就好。 */
  const settledIds = new Set(
    ledgerRows.filter((row) => row.kind === 'ACTUAL' && row.settlesId).map((row) => row.settlesId!)
  )

  const budgetStatuses: BudgetStatus[] = budgetRows.map((row) => {
    const cap = inDisplay(row.amount, row.currency)

    /*
     * 預算比對的是**實際加已承諾**，不是只比實際。
     *
     * 只比實際的話，一堆已經排下去、錢等著被扣的任務不會算進來——而那正是
     * 「還能不能再排」最需要知道的部分。
     */
    const spent = ledgerRows
      .filter((line) => line.projectId === row.projectId)
      .filter((line) => !row.period || line.period === row.period)
      .reduce((total, line) => {
        if (line.kind === 'ACTUAL') return total + inDisplay(line.amount, line.currency)
        if (!settledIds.has(line.id)) return total + inDisplay(line.amount, line.currency)
        return total
      }, 0)

    const usedPct = cap > 0 ? (spent / cap) * 100 : 0

    return {
      id: row.id,
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      category: row.category,
      period: row.period,
      cap,
      spent,
      usedPct,
      alertThresholdPct: row.alertThresholdPct,
      state: budgetState(usedPct, row.alertThresholdPct),
    }
  })

  /* ---- 明細 ---- */

  const recent: CostLine[] = [
    ...ledgerRows.map((row) => ({
      id: row.id,
      when: row.occurredAt,
      projectTitle: row.projectTitle,
      what: row.description || row.source,
      amount: inDisplay(row.amount, row.currency),
      currency,
      source: row.source,
      settled: row.kind === 'ACTUAL',
    })),
    ...expenseRows.map((row) => ({
      id: row.id,
      when: row.spentAt,
      projectTitle: row.projectTitle,
      what: row.description || row.vendor,
      amount: inDisplay(row.amount, row.currency),
      currency,
      source: row.category,
      // 手動記的支出是已經花掉的錢，沒有「估算」這回事。
      settled: true,
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, limit)

  return {
    totals,
    byProject,
    byMonth,
    budgets: budgetStatuses,
    recent,
    hasData: ledgerRows.length > 0 || expenseRows.length > 0,
  }
}

/** 最近一筆花費是什麼時候，給「資料到哪一天為止」用。 */
export async function lastCostAt(): Promise<Date | null> {
  const [row] = await db
    .select({ at: usageLedger.occurredAt })
    .from(usageLedger)
    .orderBy(desc(usageLedger.occurredAt))
    .limit(1)

  return row?.at ?? null
}

/** 這部作品目前的用量，給排任務之前檢查預算用。 */
export async function projectSpendUsd(projectId: string): Promise<number> {
  const rows = await db
    .select({
      id: usageLedger.id,
      kind: usageLedger.kind,
      settlesId: usageLedger.settlesId,
      amount: usageLedger.amount,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.projectId, projectId), sql`${usageLedger.currency} = 'USD'`))

  const split = splitLedger(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind as 'ESTIMATE' | 'ACTUAL',
      settlesId: row.settlesId,
      amount: Number(row.amount) || 0,
    }))
  )

  return split.actual + split.committed
}
