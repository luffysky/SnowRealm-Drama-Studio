import { asc } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

/**
 * 工作室的成員清單——「指派給誰」那個下拉的選項就是它 (Z166).
 *
 * ## 為什麼不是「本專案的成員」
 *
 * 這個 schema 裡**沒有** per-project 成員這回事。`project-access.ts` 的
 * `visibleProjects()` 說得很清楚：兩個人都看得到每一部沒被軟刪的作品，而那
 * 條規則刻意只住在一個地方，等以後要收緊時只改一處。
 *
 * 所以這裡誠實地叫「工作室成員」而不是「專案成員」——它回的就是全部的使用
 * 者。`tasks.ts` 本來自己寫了一份一樣的查詢；兩份一樣的東西就是下一次只改
 * 一邊，所以併成這一支。
 */
export async function studioMembers(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.createdAt))
}
