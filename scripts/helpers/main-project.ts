/**
 * 挑一部作品，而且每次挑到同一部 (Z144).
 *
 * 這支的存在是因為一個真的把我騙過去的 bug。好幾支探測腳本都這樣寫：
 *
 *     const [project] = await db.select(...).from(projects).limit(1)
 *
 * **`limit(1)` 沒有 `order by` 的時候，Postgres 不保證回哪一列。** 這個工作室
 * 有兩部作品，所以同一支腳本跑兩次可能讀到不同的小說。
 *
 * 實際發生的事：我改了情緒判斷的規則，重跑探測，看到 cheerful 從 30 句掉到
 * 3 句，差點以為自己改壞了——其實是那一次讀到了另一部作品。**一個不穩定的
 * 量測工具，會讓你去修一個不存在的問題。**
 *
 * 更糟的是 `seed-cast-voices.ts` 也這樣寫，而那支會**寫資料**。
 *
 * 所以：永遠照 `created_at` 排，最舊的那部就是主作品。要指定別部就傳標題。
 */
export async function mainProject(titleContains?: string): Promise<{
  id: string
  title: string
}> {
  const { db } = await import('../../src/db')
  const { projects } = await import('../../src/db/schema')
  const { asc, isNull } = await import('drizzle-orm')

  const rows = await db
    .select({ id: projects.id, title: projects.title, createdAt: projects.createdAt })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(asc(projects.createdAt))

  if (rows.length === 0) throw new Error('沒有作品——先跑 npm run db:seed')

  const picked = titleContains
    ? rows.find((row) => row.title.includes(titleContains))
    : rows[0]

  if (!picked) {
    throw new Error(
      `找不到標題含「${titleContains}」的作品。現有：${rows.map((r) => r.title).join('、')}`
    )
  }

  return { id: picked.id, title: picked.title }
}
