import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 手動記帳與預算上限（Z197）。
 *
 * 這兩個入口在這之前不存在：`expenses` 只有 AI 任務自己記帳與匯入 CSV 兩個寫
 * 入點，而 `budgets` 是三個地方讀、**零個地方寫**——所以規格 §6.7 的「超支擋下
 * 任務」從來沒有生效過。
 *
 * 守的是三件不會在畫面上看出來的事：
 *
 * 1. **歸屬**：集數要屬於那個作品、預算要屬於那個作品才刪得掉。外鍵只保證 id
 *    存在，不保證它是誰的。
 * 2. **upsert 的 NULL 語意**：`budgets_scope_key` 是 `(project_id, category,
 *    period)` 上的 unique，而 Postgres 的 unique 把 NULL 當成互不相等——「整個
 *    作品」那一筆兩欄都是 null，靠 `onConflict` 去不了重，一設再設會長出好幾
 *    列而且每一列都合法。
 * 3. **匯率在記帳當下就定下來**：`exchange_rate` 這一欄存在的理由就是這個。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('手動記帳與預算（Z197）', () => {
  let addExpense: typeof import('@/lib/costs-write').addExpense
  let upsertBudget: typeof import('@/lib/costs-write').upsertBudget
  let deleteBudget: typeof import('@/lib/costs-write').deleteBudget

  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let eq: typeof import('drizzle-orm').eq

  let projectId = ''
  let otherProjectId = ''
  let otherEpisodeId = ''
  let userId = ''
  let user = {} as never

  beforeAll(async () => {
    if (!hasDb) return
    ;({ addExpense, upsertBudget, deleteBudget } = await import('@/lib/costs-write'))
    ;({ db } = await import('@/db'))
    schema = await import('@/db/schema')
    ;({ eq } = await import('drizzle-orm'))

    const stamp = Date.now()

    const [row] = await db
      .insert(schema.users)
      .values({
        name: 'Z197 記帳的人',
        email: `z197c-${stamp}@example.invalid`,
        account: `z197c-${stamp}`,
        passwordHash: 'x',
        role: 'OWNER',
      })
      .returning({ id: schema.users.id })
    userId = row!.id
    user = { id: userId, name: 'Z197 記帳的人', role: 'OWNER' } as never

    const made = await db
      .insert(schema.projects)
      .values([
        { title: 'Z197 甲', slug: `z197c-a-${stamp}` },
        { title: 'Z197 乙', slug: `z197c-b-${stamp}` },
      ])
      .returning({ id: schema.projects.id })
    projectId = made[0]!.id
    otherProjectId = made[1]!.id

    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId: otherProjectId, index: 1, title: '乙卷一' })
      .returning({ id: schema.arcs.id })
    const [episode] = await db
      .insert(schema.episodes)
      .values({ projectId: otherProjectId, arcId: arc!.id, number: 1, title: '乙第一集' })
      .returning({ id: schema.episodes.id })
    otherEpisodeId = episode!.id
  })

  afterAll(async () => {
    if (!hasDb) return
    for (const id of [projectId, otherProjectId]) {
      if (id) await db.delete(schema.projects).where(eq(schema.projects.id, id))
    }
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId))
  })

  it('記一筆帳，而且匯率是當下存下來的', async () => {
    const { id } = await addExpense(
      {
        projectId,
        category: 'OUTSOURCING',
        description: 'EP001 配音外包',
        amount: '3500.00',
        currency: 'TWD',
      },
      user
    )

    const [row] = await db
      .select({
        description: schema.expenses.description,
        amount: schema.expenses.amount,
        currency: schema.expenses.currency,
        exchangeRate: schema.expenses.exchangeRate,
        baseCurrency: schema.expenses.baseCurrency,
        createdById: schema.expenses.createdById,
        paidById: schema.expenses.paidById,
      })
      .from(schema.expenses)
      .where(eq(schema.expenses.id, id))

    expect(row!.description).toBe('EP001 配音外包')
    expect(Number(row!.amount)).toBe(3500)
    expect(row!.currency).toBe('TWD')
    expect(row!.createdById).toBe(userId)
    // 沒指定付款人就是記帳的那個人，不是 null。
    expect(row!.paidById).toBe(userId)
    // 同幣別時匯率是 1，而且**真的有寫**——預設值也是 1，所以順便驗基準幣別。
    expect(Number(row!.exchangeRate)).toBe(1)
    expect(row!.baseCurrency).toBe('TWD')
  })

  it('換一個幣別，匯率不會是 1', async () => {
    const { id } = await addExpense(
      { projectId, description: 'OpenAI 訂閱', amount: '20', currency: 'USD' },
      user
    )
    const [row] = await db
      .select({ exchangeRate: schema.expenses.exchangeRate })
      .from(schema.expenses)
      .where(eq(schema.expenses.id, id))
    expect(Number(row!.exchangeRate)).toBeGreaterThan(1)
  })

  it('別部作品的集數掛不上來', async () => {
    await expect(
      addExpense(
        { projectId, episodeId: otherEpisodeId, description: '亂掛', amount: '1', currency: 'TWD' },
        user
      )
    ).rejects.toThrow(/不屬於這個作品/)
  })

  it('認不得的幣別會被擋下來，不會悄悄存進去', async () => {
    await expect(
      addExpense({ projectId, description: '幣別怪怪的', amount: '1', currency: 'XYZ' }, user)
    ).rejects.toThrow(/幣別/)
  })

  it('同一個範圍設兩次是改掉它，不是長出第二列', async () => {
    /*
     * 這一條守的是 NULL 的 unique 語意。「整個作品、不分期間」那一筆
     * `category` 與 `period` 都是 null，而 Postgres 的 unique 認為
     * `null <> null`——所以靠 unique 或 `onConflict` 都擋不住重複。
     */
    await upsertBudget({ projectId, amount: '10000', currency: 'TWD' }, user)
    await upsertBudget({ projectId, amount: '20000', currency: 'TWD' }, user)

    const rows = await db
      .select({ id: schema.budgets.id, amount: schema.budgets.amount })
      .from(schema.budgets)
      .where(eq(schema.budgets.projectId, projectId))

    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.amount)).toBe(20000)
  })

  it('不同類別是不同的範圍，會各自一列', async () => {
    await upsertBudget({ projectId, category: 'AI_API', amount: '500', currency: 'USD' }, user)

    const rows = await db
      .select({ category: schema.budgets.category })
      .from(schema.budgets)
      .where(eq(schema.budgets.projectId, projectId))

    expect(rows).toHaveLength(2)
    // `sort()` 會把 null 轉成字串 'null' 再比，所以別靠它——直接問集合。
    const categories = rows.map((row) => row.category)
    expect(categories).toContain(null)
    expect(categories).toContain('AI_API')
  })

  it('期間要寫成 YYYY-MM', async () => {
    await expect(
      upsertBudget({ projectId, period: '2026/11', amount: '100', currency: 'TWD' }, user)
    ).rejects.toThrow(/YYYY-MM/)
  })

  it('預算設下去之後，超支的任務真的會被擋', async () => {
    /*
     * 這才是整件事的重點：`assertWithinBudget` 在這之前**每一次都放行**，因為
     * 沒有任何程式寫過 `budgets`。所以這裡不只驗「寫得進去」，還驗那個閘門真
     * 的因此關起來了。
     */
    const { checkBudget } = await import('@/lib/usage')

    await upsertBudget(
      { projectId, category: 'AI_API', amount: '0.01', currency: 'USD' },
      user
    )
    const blocked = await checkBudget({ projectId, additionalUsd: 100 })
    expect(blocked.allowed).toBe(false)
    // 判定是一個聯合型別，`reason` 只在被擋下來那一支上。
    if (blocked.allowed) throw new Error('預算沒有擋下來')
    expect(blocked.reason).toContain('預算上限')

    // 沒有上限的那部作品照常放行——上面那一條不可以因為「全部都擋」而通過。
    const open = await checkBudget({ projectId: otherProjectId, additionalUsd: 100 })
    expect(open.allowed).toBe(true)
  })

  it('別部作品的預算刪不掉', async () => {
    const { id } = await upsertBudget(
      { projectId: otherProjectId, amount: '999', currency: 'TWD' },
      user
    )

    await expect(deleteBudget(projectId, id, user)).rejects.toThrow(/找不到/)

    // 真的還在——上面那一條不可以因為「它本來就不存在」而通過。
    const rows = await db
      .select({ id: schema.budgets.id })
      .from(schema.budgets)
      .where(eq(schema.budgets.id, id))
    expect(rows).toHaveLength(1)

    // 用對的作品就刪得掉。
    await deleteBudget(otherProjectId, id, user)
    const after = await db
      .select({ id: schema.budgets.id })
      .from(schema.budgets)
      .where(eq(schema.budgets.id, id))
    expect(after).toHaveLength(0)
  })
})
