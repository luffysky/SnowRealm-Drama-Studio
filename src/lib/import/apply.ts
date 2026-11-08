import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  arcs,
  characters,
  chapters,
  documents,
  episodes,
  expenses,
  shots,
  tasks,
  worldEntries,
} from '@/db/schema'
import { scenes } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { foldForSearch } from '@/lib/chinese'
import type { MappedRows, MapContext, NewVocabulary } from '@/lib/import/map'
import { parseNovelMarkdown } from '@/lib/import/novel-doc'
import type { ImportTargetKey } from '@/lib/import/targets'
import { addVocabularyTerm, listVocabulary } from '@/lib/vocabulary'

/**
 * 把對應好的列寫進資料庫 (Z185).
 *
 * ## 先建選項，再寫資料
 *
 * 景別與運鏡認不得的值會變成新的下拉選項，而那必須**先**建起來——`createShot`
 * 會驗這一欄的值在不在清單裡（Z184），順序反了的話每一列都會被擋下來。
 *
 * ## 不覆蓋，只新增（集數例外）
 *
 * 匯入是「把東西加進來」，不是「拿這份檔案取代現況」。同名的角色、同樣的世界
 * 觀條目會被跳過並回報——因為一個打錯的匯入如果會覆蓋，使用者就失去了「再試
 * 一次」這個選項。
 *
 * 集數大綱是唯一的例外，而且是刻意的：那一份本來就是「把大綱填進既有的集」，
 * 所以同集號會更新。它只動大綱欄位，不碰正文、不碰狀態以外的東西。
 */

export type ImportContext = {
  user: SessionUser
  projectId: string
  /** `scope: 'episode'` 的目標要有。 */
  episodeId?: string | null
}

export type ImportOutcome = {
  created: number
  updated: number
  skipped: number
  /** 順手建起來的下拉選項。 */
  addedOptions: { kind: string; label: string; value: string }[]
  notes: string[]
}

/** 匯入前要先知道現有的角色與自訂選項。 */
export async function buildMapContext(projectId: string): Promise<MapContext> {
  const [terms, cast] = await Promise.all([
    listVocabulary(),
    db
      .select({ id: characters.id, name: characters.name, alias: characters.alias })
      .from(characters)
      .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt))),
  ])

  /*
   * 名字與別名都收，而且折過繁簡——檔案寫「许山河」要對得到角色表裡的「許山
   * 河」。先放別名再放本名，所以本名會覆蓋掉撞名的別名。
   */
  const byName = new Map<string, string>()
  for (const person of cast) {
    for (const alias of person.alias.split(/[、,，/|]+/)) {
      const key = foldForSearch(alias.trim())
      if (key) byName.set(key, person.id)
    }
  }
  for (const person of cast) byName.set(foldForSearch(person.name), person.id)

  return { terms, characters: byName }
}

/* -------------------------------------------------------------------------- */

export async function applyImport(
  target: ImportTargetKey,
  mapped: MappedRows,
  context: ImportContext
): Promise<ImportOutcome> {
  const addedOptions = await createOptions(mapped.newVocabulary, context.user)
  const notes: string[] = []

  switch (target) {
    case 'shots':
      return { ...(await applyShots(mapped, context, notes)), addedOptions, notes }
    case 'characters':
      return { ...(await applyCharacters(mapped, context, notes)), addedOptions, notes }
    case 'world':
      return { ...(await applyWorld(mapped, context, notes)), addedOptions, notes }
    case 'episodes':
      return { ...(await applyEpisodes(mapped, context, notes)), addedOptions, notes }
    case 'chapters':
      return { ...(await applyChapters(mapped, context, notes)), addedOptions, notes }
    case 'scenes':
      return { ...(await applyScenes(mapped, context, notes)), addedOptions, notes }
    case 'tasks':
      return { ...(await applyTasks(mapped, context, notes)), addedOptions, notes }
    case 'expenses':
      return { ...(await applyExpenses(mapped, context, notes)), addedOptions, notes }
  }
}

/**
 * 先把新的下拉選項建起來。
 *
 * 撞名的照舊跳過——`addVocabularyTerm` 自己會擋，而這裡把它當成「已經有了」
 * 而不是錯誤：兩個檔案都寫了「過肩」的時候，第二個不該整批失敗。
 */
async function createOptions(
  wanted: readonly NewVocabulary[],
  user: SessionUser
): Promise<ImportOutcome['addedOptions']> {
  const added: ImportOutcome['addedOptions'] = []
  for (const item of wanted) {
    try {
      const term = await addVocabularyTerm({
        user,
        kind: item.kind,
        value: item.value,
        label: item.label,
      })
      added.push({ kind: term.kind, label: term.label, value: term.value })
    } catch {
      // 已經有了就當成成功——重複匯入不該是錯誤。
    }
  }
  return added
}

type Counts = { created: number; updated: number; skipped: number }

/**
 * 一次 INSERT 幾列 (Z190).
 *
 * Postgres 的 wire protocol 一個 statement 最多 65535 個綁定參數，而 drizzle
 * 每一列會產生一個參數一欄。鏡頭有十四到十五欄，所以一個 statement 最多四千
 * 多列——而驗證器允許到五千列。超過會在協定層失敗，而那個錯誤訊息跟資料一點
 * 關係都沒有。
 *
 * 五百列對每一種區塊都安全（最多十五欄＝七千五百個參數），而且分批之後記憶
 * 體峰值也小。
 */
const INSERT_CHUNK = 500

async function insertInChunks<T>(
  run: (slice: T[]) => Promise<unknown>,
  values: T[]
): Promise<void> {
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    await run(values.slice(i, i + INSERT_CHUNK))
  }
}

const text = (row: Record<string, unknown>, key: string, fallback = '') =>
  typeof row[key] === 'string' ? (row[key] as string) : fallback
const num = (row: Record<string, unknown>, key: string, fallback: number) =>
  typeof row[key] === 'number' ? (row[key] as number) : fallback
const date = (row: Record<string, unknown>, key: string): Date | null => {
  const value = row[key]
  return typeof value === 'string' && value ? new Date(value) : null
}

function requireEpisode(context: ImportContext): string {
  if (!context.episodeId) throw ApiError.badRequest('這一種匯入要先選一集')
  return context.episodeId
}

/**
 * 一份小說 Markdown：集數欄位 + 一堆章節 (Z186).
 *
 * **在伺服器端重新剖析一次**，不吃用戶端送來的結果。前端剖過是為了預覽，而
 * 預覽與實際寫入走同一支純函式、同一份輸入——兩邊各自解讀的話，畫面說「八
 * 章」而資料庫拿到一章。
 *
 * 集數的標題／一句話／大綱**只在原本是空的時候**才填。這一份檔案是「把內容
 * 帶進來」，不是「拿它取代現況」——而使用者已經寫過的那一句，不該被一份順手
 * 匯入的檔案蓋掉。
 */
export async function applyNovelDocument(
  text: string,
  context: ImportContext
): Promise<ImportOutcome> {
  const episodeId = requireEpisode(context)
  const doc = parseNovelMarkdown(text)
  const notes: string[] = [doc.note]

  const [episode] = await db
    .select({
      id: episodes.id,
      title: episodes.title,
      logline: episodes.logline,
      synopsis: episodes.synopsis,
    })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, context.projectId)))
    .limit(1)
  if (!episode) throw ApiError.badRequest('指定的集數不屬於這個作品')

  const patch: Record<string, string> = {}
  if (doc.episode.title && !episode.title) patch.title = doc.episode.title
  if (doc.episode.logline && !episode.logline) patch.logline = doc.episode.logline
  if (doc.episode.synopsis && !episode.synopsis) patch.synopsis = doc.episode.synopsis

  const kept: string[] = []
  if (doc.episode.title && episode.title && doc.episode.title !== episode.title) kept.push('標題')
  if (doc.episode.logline && episode.logline) kept.push('一句話')
  if (doc.episode.synopsis && episode.synopsis) kept.push('大綱')

  if (Object.keys(patch).length > 0) {
    await db
      .update(episodes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId))
    notes.push(`集數的${Object.keys(patch).map(fieldLabel).join('、')}填上去了。`)
  }
  if (kept.length > 0) {
    notes.push(`${kept.join('、')}原本就有值，沒有覆蓋——要換的話自己改。`)
  }

  const documentId = await documentFor(context, 'NOVEL')
  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${chapters.sortOrder}), 0)` })
    .from(chapters)
    .where(eq(chapters.documentId, documentId))
  let order = Number(last?.max ?? 0)

  const values = doc.chapters
    .filter((chapter) => chapter.content.trim())
    .map((chapter) => {
      order += 1
      return {
        documentId,
        sortOrder: order,
        title: chapter.title,
        summary: chapter.summary,
        content: chapter.content,
        charCount: chapter.content.replace(/\s/g, '').length,
      }
    })

  if (values.length > 0) await insertInChunks((slice) => db.insert(chapters).values(slice), values)

  return {
    created: values.length,
    updated: Object.keys(patch).length > 0 ? 1 : 0,
    skipped: doc.chapters.length - values.length,
    addedOptions: [],
    notes,
  }
}

function fieldLabel(key: string): string {
  return key === 'title' ? '標題' : key === 'logline' ? '一句話' : '大綱'
}

/* ---- 分鏡 ---------------------------------------------------------------- */

async function applyShots(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const episodeId = requireEpisode(context)

  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, context.projectId)))
    .limit(1)
  if (!episode) throw ApiError.badRequest('指定的集數不屬於這個作品')

  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${shots.order}), 0)` })
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
  let order = Number(last?.max ?? 0)

  const values = mapped.rows.map((row) => {
    order += 1
    return {
      episodeId,
      order,
      sceneCode: text(row, 'sceneCode'),
      durationSec: num(row, 'durationSec', 5),
      shotSize: text(row, 'shotSize', 'MS'),
      camera: text(row, 'camera', 'STATIC'),
      location: text(row, 'location'),
      timeOfDay: text(row, 'timeOfDay'),
      action: text(row, 'action'),
      dialogue: text(row, 'dialogue'),
      speakerId: text(row, 'speaker') || null,
      prompt: text(row, 'prompt'),
      negativePrompt: text(row, 'negativePrompt'),
      notes: text(row, 'notes'),
      ...(text(row, 'status') ? { status: text(row, 'status') as 'TODO' } : {}),
    }
  })

  if (values.length === 0) return { created: 0, updated: 0, skipped: mapped.skipped.length }
  await insertInChunks((slice) => db.insert(shots).values(slice), values)
  notes.push(`接在既有鏡頭後面，從第 ${Number(last?.max ?? 0) + 1} 鏡開始。`)
  return { created: values.length, updated: 0, skipped: mapped.skipped.length }
}

/* ---- 角色 ---------------------------------------------------------------- */

async function applyCharacters(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const existing = await db
    .select({ name: characters.name })
    .from(characters)
    .where(and(eq(characters.projectId, context.projectId), isNull(characters.deletedAt)))
  const taken = new Set(existing.map((row) => foldForSearch(row.name)))

  let created = 0
  let skipped = mapped.skipped.length
  const duplicates: string[] = []

  for (const row of mapped.rows) {
    const name = text(row, 'name')
    const key = foldForSearch(name)
    if (taken.has(key)) {
      duplicates.push(name)
      skipped += 1
      continue
    }
    taken.add(key)

    await db.insert(characters).values({
      projectId: context.projectId,
      name,
      alias: text(row, 'alias'),
      age: text(row, 'age'),
      gender: text(row, 'gender'),
      appearance: text(row, 'appearance'),
      personality: text(row, 'personality'),
      background: text(row, 'background'),
      growth: text(row, 'growth'),
      visualPrompt: text(row, 'visualPrompt'),
      negativePrompt: text(row, 'negativePrompt'),
      voiceNote: text(row, 'voiceNote'),
      ...(text(row, 'tier') ? { tier: text(row, 'tier') as 'LEAD' } : {}),
    })
    created += 1
  }

  if (duplicates.length > 0) {
    notes.push(`已經存在、跳過沒有覆蓋：${duplicates.slice(0, 8).join('、')}${duplicates.length > 8 ? ' 等' : ''}`)
  }
  return { created, updated: 0, skipped }
}

/* ---- 世界觀 -------------------------------------------------------------- */

async function applyWorld(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const existing = await db
    .select({ title: worldEntries.title })
    .from(worldEntries)
    .where(and(eq(worldEntries.projectId, context.projectId), isNull(worldEntries.deletedAt)))
  const taken = new Set(existing.map((row) => foldForSearch(row.title)))

  let created = 0
  let skipped = mapped.skipped.length
  const duplicates: string[] = []

  for (const row of mapped.rows) {
    const title = text(row, 'title')
    const key = foldForSearch(title)
    if (taken.has(key)) {
      duplicates.push(title)
      skipped += 1
      continue
    }
    taken.add(key)

    await db.insert(worldEntries).values({
      projectId: context.projectId,
      title,
      summary: text(row, 'summary'),
      body: text(row, 'body'),
      tags: text(row, 'tags') ? text(row, 'tags').split('\n').filter(Boolean) : [],
      ...(text(row, 'category') ? { category: text(row, 'category') as 'OTHER' } : {}),
    })
    created += 1
  }

  if (duplicates.length > 0) {
    notes.push(`已經有同名條目、跳過：${duplicates.slice(0, 8).join('、')}`)
  }
  return { created, updated: 0, skipped }
}

/* ---- 集數大綱 ------------------------------------------------------------ */

/**
 * 唯一會**更新**既有資料的一種。
 *
 * 大綱本來就是「填進既有的集」，所以同集號更新；而它只動標題、一句話、大綱、
 * 目標片長與狀態——正文、封面、成片一個字都不碰。
 */
async function applyEpisodes(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const existing = await db
    .select({ id: episodes.id, number: episodes.number })
    .from(episodes)
    .where(and(eq(episodes.projectId, context.projectId), isNull(episodes.deletedAt)))
  const byNumber = new Map(existing.map((row) => [row.number, row.id]))

  const [firstArc] = await db
    .select({ id: arcs.id })
    .from(arcs)
    .where(eq(arcs.projectId, context.projectId))
    .orderBy(asc(arcs.index))
    .limit(1)

  let created = 0
  let updated = 0
  let skipped = mapped.skipped.length
  /** 這一批裡已經處理過的集號。 */
  const seen = new Set<number>()
  const duplicated: number[] = []

  for (const row of mapped.rows) {
    const number = num(row, 'number', 0)
    if (number <= 0) {
      skipped += 1
      continue
    }

    const patch = {
      title: text(row, 'title'),
      logline: text(row, 'logline'),
      synopsis: text(row, 'synopsis'),
      ...(typeof row.targetSec === 'number' ? { targetSec: row.targetSec } : {}),
      ...(text(row, 'status') ? { status: text(row, 'status') as 'PLANNED' } : {}),
      updatedAt: new Date(),
    }

    /*
     * 同一個檔案裡出現兩次同一集號的時候，第二次只能跳過 (Z190).
     *
     * 原本的寫法是插入之後 `byNumber.set(number, 'new')` 當佔位，而下一列拿
     * 到那個 `'new'` 之後會去跑 `where(eq(episodes.id, 'new'))`——`id` 是
     * uuid 欄，Postgres 回語法錯誤，整支 500。而前面那些列已經寫進去了（沒有
     * 交易），所以使用者看到的是一個錯誤加一半的資料。
     */
    if (seen.has(number)) {
      duplicated.push(number)
      skipped += 1
      continue
    }
    seen.add(number)

    const id = byNumber.get(number)
    if (id) {
      // 空字串不覆蓋既有的值——檔案沒填那一欄不代表要清空它。
      const nonEmpty = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== '')
      )
      await db.update(episodes).set(nonEmpty).where(eq(episodes.id, id))
      updated += 1
      continue
    }

    if (!firstArc) {
      notes.push('這部作品還沒有卷，新的集數建不了——請先建一個卷。')
      skipped += 1
      continue
    }
    await db.insert(episodes).values({
      projectId: context.projectId,
      arcId: firstArc.id,
      number,
      ...patch,
    })
    created += 1
  }

  if (updated > 0) notes.push(`${updated} 集已經存在，更新了大綱（正文沒有動）。`)
  if (duplicated.length > 0) {
    notes.push(
      `檔案裡有重複的集號（第 ${duplicated.slice(0, 8).join('、')} 集），只用了第一次出現的那一列。`
    )
  }
  return { created, updated, skipped }
}

/* ---- 小說章節 ------------------------------------------------------------ */

async function applyChapters(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const documentId = await documentFor(context, 'NOVEL')

  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${chapters.sortOrder}), 0)` })
    .from(chapters)
    .where(eq(chapters.documentId, documentId))
  let order = Number(last?.max ?? 0)

  const values = mapped.rows.map((row) => {
    order += 1
    const content = text(row, 'content')
    return {
      documentId,
      sortOrder: order,
      title: text(row, 'title'),
      summary: text(row, 'summary'),
      content,
      // 跟編輯器同一條算法：不含空白。
      charCount: content.replace(/\s/g, '').length,
    }
  })

  if (values.length === 0) return { created: 0, updated: 0, skipped: mapped.skipped.length }
  await insertInChunks((slice) => db.insert(chapters).values(slice), values)
  notes.push(`接在既有章節後面，從第 ${Number(last?.max ?? 0) + 1} 章開始。`)
  return { created: values.length, updated: 0, skipped: mapped.skipped.length }
}

/* ---- 劇本場次 ------------------------------------------------------------ */

async function applyScenes(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const documentId = await documentFor(context, 'SCRIPT')

  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${scenes.sortOrder}), 0)` })
    .from(scenes)
    .where(eq(scenes.documentId, documentId))
  let order = Number(last?.max ?? 0)

  const values = mapped.rows.map((row) => {
    order += 1
    return {
      documentId,
      sortOrder: order,
      code: text(row, 'code'),
      heading: text(row, 'heading'),
      location: text(row, 'location'),
      timeOfDay: text(row, 'timeOfDay'),
      content: text(row, 'content'),
      estimatedSec: num(row, 'estimatedSec', 0),
    }
  })

  if (values.length === 0) return { created: 0, updated: 0, skipped: mapped.skipped.length }
  await insertInChunks((slice) => db.insert(scenes).values(slice), values)
  notes.push(`接在既有場次後面，從第 ${Number(last?.max ?? 0) + 1} 場開始。`)
  return { created: values.length, updated: 0, skipped: mapped.skipped.length }
}

/**
 * 這一集的小說／劇本文件，沒有就建一個。
 *
 * 建一個空文件是安全的：它本來就是使用者點進那一頁時會被建出來的東西。
 */
async function documentFor(context: ImportContext, kind: 'NOVEL' | 'SCRIPT'): Promise<string> {
  const episodeId = requireEpisode(context)

  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, context.projectId)))
    .limit(1)
  if (!episode) throw ApiError.badRequest('指定的集數不屬於這個作品')

  const [found] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.episodeId, episodeId), eq(documents.kind, kind), isNull(documents.deletedAt))
    )
    .limit(1)
  if (found) return found.id

  const [made] = await db
    .insert(documents)
    .values({ episodeId, kind })
    .returning({ id: documents.id })
  if (!made) throw new Error('Failed to create document')
  return made.id
}

/* ---- 任務 ---------------------------------------------------------------- */

async function applyTasks(
  mapped: MappedRows,
  context: ImportContext,
  _notes: string[]
): Promise<Counts> {
  const values = mapped.rows.map((row) => ({
    projectId: context.projectId,
    title: text(row, 'title'),
    description: text(row, 'description'),
    progress: num(row, 'progress', 0),
    createdById: context.user.id,
    ...(text(row, 'status') ? { status: text(row, 'status') as 'BACKLOG' } : {}),
    ...(text(row, 'priority') ? { priority: text(row, 'priority') as 'NORMAL' } : {}),
    ...(date(row, 'dueDate') ? { dueDate: date(row, 'dueDate') as Date } : {}),
  }))

  if (values.length === 0) return { created: 0, updated: 0, skipped: mapped.skipped.length }
  await insertInChunks((slice) => db.insert(tasks).values(slice), values)
  return { created: values.length, updated: 0, skipped: mapped.skipped.length }
}

/* ---- 支出 ---------------------------------------------------------------- */

async function applyExpenses(
  mapped: MappedRows,
  context: ImportContext,
  notes: string[]
): Promise<Counts> {
  const values = mapped.rows.map((row) => ({
    projectId: context.projectId,
    description: text(row, 'description'),
    /*
     * 金額存成字串給 numeric 欄位。**不換算幣別**：匯率要用當天的，而檔案裡
     * 沒有那個資訊——自己填一個會變成虛構的數字（spec 23：金額不可虛構）。
     */
    amount: String(num(row, 'amount', 0)),
    currency: text(row, 'currency', 'TWD').toUpperCase().slice(0, 8) || 'TWD',
    vendor: text(row, 'vendor'),
    note: text(row, 'note'),
    createdById: context.user.id,
    ...(text(row, 'category') ? { category: text(row, 'category') as 'OTHER' } : {}),
    ...(date(row, 'spentAt') ? { spentAt: date(row, 'spentAt') as Date } : {}),
  }))

  if (values.length === 0) return { created: 0, updated: 0, skipped: mapped.skipped.length }
  await insertInChunks((slice) => db.insert(expenses).values(slice), values)
  notes.push('匯率沒有換算：匯入的金額照原幣別存著，成本中心會用當天的匯率換算。')
  return { created: values.length, updated: 0, skipped: mapped.skipped.length }
}
