import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  characters,
  chapters,
  documents,
  episodes,
  expenses,
  shots,
  scenes,
  tasks,
  worldEntries,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import {
  CHARACTER_TIER_LABEL,
  EPISODE_STATUS_LABEL,
  EXPENSE_CATEGORY_LABEL,
  SHOT_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  WORLD_CATEGORY_LABEL,
} from '@/lib/constants'
import { importTarget, type ImportTargetKey } from '@/lib/import/targets'
import { listVocabulary, vocabularyTermLabel } from '@/lib/vocabulary'

/**
 * 把現有資料倒出來，欄位跟匯入**完全一樣** (Z185).
 *
 * 所以匯出的檔案可以直接改一改再匯回去，而且可以拿給模型當「現況」看。這不是
 * 順手做的對稱——它是這個功能的一半：沒有匯出的話，「請模型照我現在的角色設
 * 定補完」這件事要人自己把資料抄出來。
 *
 * ## 值寫成人看得懂的字，不是代碼
 *
 * 景別寫「近景」不是 `MCU`，狀態寫「待處理」不是 `TODO`——因為匯出的檔案是要
 * 給人跟模型看的，而匯入那一端兩種都認得（`mapRows` 比對標籤也比對代碼）。
 */

export type ExportTable = { headers: string[]; rows: string[][] }

export async function exportRows(
  target: ImportTargetKey,
  input: { projectId: string; episodeId?: string | null }
): Promise<ExportTable> {
  const definition = importTarget(target)
  const headers = definition.fields.map((field) => field.label)
  const records = await fetchRecords(target, input)

  return {
    headers,
    rows: records.map((record) =>
      definition.fields.map((field) => {
        const value = record[field.key]
        return value === null || value === undefined ? '' : String(value)
      })
    ),
  }
}

type Row = Record<string, string | number | null>

async function fetchRecords(
  target: ImportTargetKey,
  input: { projectId: string; episodeId?: string | null }
): Promise<Row[]> {
  const { projectId } = input

  switch (target) {
    case 'shots': {
      /*
       * 要驗這一集屬於這個作品 (Z190).
       *
       * 原本只檢查 `episodeId` 非空，然後直接 `where(shots.episodeId = …)`
       * ——而那個值是從查詢字串拿的。同一個檔案裡的 `documentFor` 有驗，
       * `apply.ts` 的每一條寫入路徑也都有驗，只有這一條漏了。
       *
       * 今天還不是可利用的漏洞（`visibleProjects()` 讓兩個人都看得到所有作
       * 品），但 `project-access.ts` 自己的註解寫著「收緊成員權限時只要改一
       * 個地方」——這一行就是那個地方改完之後唯一還會漏的。
       */
      const episodeId = await episodeInProject(requireEpisode(input), projectId)
      const terms = await listVocabulary()
      const rows = await db
        .select({
          sceneCode: shots.sceneCode,
          durationSec: shots.durationSec,
          shotSize: shots.shotSize,
          camera: shots.camera,
          location: shots.location,
          timeOfDay: shots.timeOfDay,
          action: shots.action,
          dialogue: shots.dialogue,
          speaker: characters.name,
          prompt: shots.prompt,
          negativePrompt: shots.negativePrompt,
          status: shots.status,
          notes: shots.notes,
        })
        .from(shots)
        .leftJoin(characters, eq(characters.id, shots.speakerId))
        .where(eq(shots.episodeId, episodeId))
        .orderBy(asc(shots.order))

      return rows.map((row) => ({
        ...row,
        shotSize: vocabularyTermLabel('shot_size', row.shotSize, terms),
        camera: vocabularyTermLabel('camera_move', row.camera, terms),
        status: SHOT_STATUS_LABEL[row.status] ?? row.status,
      }))
    }

    case 'characters': {
      const rows = await db
        .select()
        .from(characters)
        .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt)))
        .orderBy(asc(characters.createdAt))
      return rows.map((row) => ({
        name: row.name,
        alias: row.alias,
        tier: CHARACTER_TIER_LABEL[row.tier] ?? row.tier,
        age: row.age,
        gender: row.gender,
        appearance: row.appearance,
        personality: row.personality,
        background: row.background,
        growth: row.growth,
        visualPrompt: row.visualPrompt,
        negativePrompt: row.negativePrompt,
        voiceNote: row.voiceNote,
      }))
    }

    case 'world': {
      const rows = await db
        .select()
        .from(worldEntries)
        .where(and(eq(worldEntries.projectId, projectId), isNull(worldEntries.deletedAt)))
        .orderBy(asc(worldEntries.createdAt))
      return rows.map((row) => ({
        title: row.title,
        category: WORLD_CATEGORY_LABEL[row.category] ?? row.category,
        summary: row.summary,
        body: row.body,
        tags: row.tags.join('、'),
      }))
    }

    case 'episodes': {
      const rows = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
        .orderBy(asc(episodes.number))
      return rows.map((row) => ({
        number: row.number,
        title: row.title,
        logline: row.logline,
        synopsis: row.synopsis,
        targetSec: row.targetSec,
        status: EPISODE_STATUS_LABEL[row.status] ?? row.status,
      }))
    }

    case 'chapters': {
      const documentId = await documentFor(requireEpisode(input), projectId, 'NOVEL')
      if (!documentId) return []
      const rows = await db
        .select()
        .from(chapters)
        .where(eq(chapters.documentId, documentId))
        .orderBy(asc(chapters.sortOrder))
      return rows.map((row) => ({
        title: row.title,
        summary: row.summary,
        content: row.content,
      }))
    }

    case 'scenes': {
      const documentId = await documentFor(requireEpisode(input), projectId, 'SCRIPT')
      if (!documentId) return []
      const rows = await db
        .select()
        .from(scenes)
        .where(eq(scenes.documentId, documentId))
        .orderBy(asc(scenes.sortOrder))
      return rows.map((row) => ({
        code: row.code,
        heading: row.heading,
        location: row.location,
        timeOfDay: row.timeOfDay,
        content: row.content,
        estimatedSec: row.estimatedSec,
      }))
    }

    case 'tasks': {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.sortOrder))
      return rows.map((row) => ({
        title: row.title,
        description: row.description,
        status: TASK_STATUS_LABEL[row.status] ?? row.status,
        priority: TASK_PRIORITY_LABEL[row.priority] ?? row.priority,
        dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : '',
        progress: row.progress,
      }))
    }

    case 'expenses': {
      const rows = await db
        .select()
        .from(expenses)
        .where(eq(expenses.projectId, projectId))
        .orderBy(asc(expenses.spentAt))
      return rows.map((row) => ({
        description: row.description,
        /*
         * 原幣別的金額，不換算。匯率是當天的，而匯出的檔案沒有地方放「用的是
         * 哪一天的匯率」——換算過的數字看起來像事實，而它是一個推論。
         */
        amount: row.amount,
        currency: row.currency,
        category: EXPENSE_CATEGORY_LABEL[row.category] ?? row.category,
        vendor: row.vendor,
        spentAt: row.spentAt.toISOString().slice(0, 10),
        note: row.note,
      }))
    }
  }
}

function requireEpisode(input: { episodeId?: string | null }): string {
  if (!input.episodeId) throw ApiError.badRequest('這一種匯出要先選一集')
  return input.episodeId
}

/**
 * 這一集真的是這個作品的嗎。
 *
 * 順便擋掉不是 uuid 的值——它會讓 Postgres 回一個語法錯誤，而那是一個 500 而
 * 不是「你給的東西不對」。
 */
async function episodeInProject(episodeId: string, projectId: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(episodeId)) {
    throw ApiError.badRequest('集數的編號格式不對')
  }
  const [found] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
    .limit(1)
  if (!found) throw ApiError.badRequest('指定的集數不屬於這個作品')
  return found.id
}

async function documentFor(
  episodeId: string,
  projectId: string,
  kind: 'NOVEL' | 'SCRIPT'
): Promise<string | null> {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
    .limit(1)
  if (!episode) throw ApiError.badRequest('指定的集數不屬於這個作品')

  const [found] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.episodeId, episodeId), eq(documents.kind, kind), isNull(documents.deletedAt))
    )
    .limit(1)
  return found?.id ?? null
}
