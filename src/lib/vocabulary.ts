import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { vocabularyTerms } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import {
  isVocabularyValue,
  vocabularyLabel,
  vocabularyOptions,
  VOCABULARY_KINDS,
  type VocabularyKind,
  type VocabularyOption,
  type VocabularyTerm,
} from '@/lib/vocabulary-view'

export * from '@/lib/vocabulary-view'

/**
 * 使用者自己加的下拉選項，查資料庫的那一半 (Z184).
 *
 * 純算的那一半（哪幾種可以加、選項怎麼排、標籤怎麼查）在
 * `@/lib/vocabulary-view`，因為用戶端元件要 import 它而這個檔案碰 `@/db`。
 */

/** 全部自訂詞，依類別與排序。一次查完，呼叫端自己分。 */
export async function listVocabulary(): Promise<VocabularyTerm[]> {
  const rows = await db
    .select({
      id: vocabularyTerms.id,
      kind: vocabularyTerms.kind,
      value: vocabularyTerms.value,
      label: vocabularyTerms.label,
    })
    .from(vocabularyTerms)
    .orderBy(asc(vocabularyTerms.kind), asc(vocabularyTerms.sortOrder), asc(vocabularyTerms.createdAt))

  /*
   * `kind` 在資料庫裡是 text，所以可能有一個這一版不認得的類別——例如某一版
   * 加了、後來拿掉了。濾掉而不是讓它流到介面：一個沒有對應下拉的詞只會在某
   * 個地方變成一個看不懂的選項。
   */
  return rows.filter((row): row is VocabularyTerm =>
    (VOCABULARY_KINDS as readonly string[]).includes(row.kind)
  )
}

/**
 * 一個類別的完整選項（內建 ∪ 自訂）。
 *
 * 不匯出：它只是 `vocabularyOptions(kind, await listVocabulary())` 兩個已經
 * 匯出的東西串起來，而呼叫端（頁面）要的是「一次查完全部類別」而不是一類查
 * 一次。測試也走那兩支，所以這裡沒有只為了測試而存在的介面。
 */
async function optionsFor(kind: VocabularyKind): Promise<VocabularyOption[]> {
  return vocabularyOptions(kind, await listVocabulary())
}

/**
 * 這個值可不可以存進去。
 *
 * 欄位從 enum 改成 text 之後，資料庫不再替我們擋亂寫的值——所以每一個寫入端
 * 都要過這一關。**不是在 zod 裡做**：zod 的解析是同步的，而合法值要查資料
 * 庫；硬塞進去會讓驗證器變成非同步，而那會傳染到每一支路由。
 */
export async function assertVocabularyValue(
  kind: VocabularyKind,
  value: string | undefined
): Promise<void> {
  if (value === undefined) return

  const allowed = await optionsFor(kind)
  if (allowed.some((option) => option.value === value)) return

  throw ApiError.badRequest(
    `「${value}」不是有效的${vocabularyLabel(kind)}。要用新的請先在下拉選單裡新增。`
  )
}

/**
 * 加一個自訂選項。
 *
 * 值不能跟內建的撞，也不能跟已經有的自訂撞——前者會讓一個標籤改掉 `MS` 的意
 * 思，後者會讓下拉出現兩個長得一樣的選項。
 */
export async function addVocabularyTerm(input: {
  user: SessionUser
  kind: VocabularyKind
  value: string
  label: string
}): Promise<VocabularyTerm> {
  const value = input.value.trim().toUpperCase()
  const label = input.label.trim()

  if (!label) throw ApiError.badRequest('要顯示的名稱不能空白')
  if (!isVocabularyValue(value)) {
    throw ApiError.badRequest('代碼只能是大寫英文字母、數字與底線，而且要以字母開頭')
  }

  const existing = await optionsFor(input.kind)
  if (existing.some((option) => option.value === value)) {
    throw ApiError.badRequest(`「${value}」已經在清單裡了`)
  }
  if (existing.some((option) => option.label === label)) {
    throw ApiError.badRequest(`已經有一個叫「${label}」的選項了`)
  }

  const [row] = await db
    .insert(vocabularyTerms)
    .values({
      kind: input.kind,
      value,
      label,
      // 接在同類最後面。數量很小，所以直接算現有的自訂有幾個。
      sortOrder: existing.filter((option) => !option.builtIn).length,
      createdById: input.user.id,
    })
    .returning({
      id: vocabularyTerms.id,
      kind: vocabularyTerms.kind,
      value: vocabularyTerms.value,
      label: vocabularyTerms.label,
    })

  if (!row) throw new Error('Failed to create vocabulary term')
  return { ...row, kind: input.kind }
}

/**
 * 刪掉一個自訂選項。
 *
 * **已經有東西在用它的時候照樣刪得掉**，而那是刻意的：這張表是「下拉裡有哪些
 * 選項」，不是「資料裡有哪些值」。擋下來的話，一個打錯字的選項只要被存過一
 * 次就永遠刪不掉。
 *
 * 代價是那幾筆資料會留著一個不在清單裡的值，而
 * `vocabularyTermLabel` 查不到就回值本身——所以畫面上看得到
 * `HANDHELD_LOW`，不是一個空格。空格會讓人以為那一格沒填。
 */
export async function deleteVocabularyTerm(input: {
  kind: VocabularyKind
  termId: string
}): Promise<void> {
  const deleted = await db
    .delete(vocabularyTerms)
    .where(and(eq(vocabularyTerms.id, input.termId), eq(vocabularyTerms.kind, input.kind)))
    .returning({ id: vocabularyTerms.id })

  if (deleted.length === 0) throw ApiError.notFound('找不到這個選項')
}
