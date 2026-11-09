import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import { db } from '@/db'
import { characters, chapters, documents, episodes, projects } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { auditPersona } from '@/lib/ai/audit-rules'
import { AUDIT_INSTRUCTIONS } from '@/lib/ai/prompts'
import {
  parseEpisodeAudit,
  parseStoryDigest,
  type AskTurn,
  type EpisodeAudit,
  type StoryDigest,
} from '@/lib/ai/story-audit-view'
import { runNow } from '@/lib/ai/vip'
import { stripHtmlToText } from '@/lib/utils'

/**
 * 編劇助手（Z198）。
 *
 * 暖寶的原話：
 *
 * > 我感覺要弄一個編劇助理，整理給我看。審核劇情是否連貫合理，細節處理是否得
 * > 當，總結一下目前的主線、人設，每一集是否有爽點和鉤子，爽點在哪裡，鉤子是
 * > 什麼。
 *
 * 關鍵是「**整理給我看**」——她要的是一份打開就看得到的東西，不是一個要先貼
 * 內容、再複製指令出去的工具。所以這一支自己去資料庫把材料湊齊，不要人填。
 *
 * ## 走 VIP 通道，不排佇列
 *
 * `ai_jobs` 的 worker 排程是每天 03:00 跑一次，排下去的東西要等到隔天。而這份
 * 產出**不寫回任何地方**，它就是一份給人讀的整理——沒有東西需要人審核之後才落
 * 地，所以整套「排隊→採用」的流程在這裡只剩下延遲。見 `vip.ts`。
 *
 * ## 一集一支請求
 *
 * 二十集一次跑完要五到十分鐘，而函式有執行時間上限。所以一次只整理一集，由畫
 * 面那一端一集一集叫——她也因此可以邊跑邊看，而不是盯著一個轉圈圈等十分鐘。
 */

export type EpisodeMaterial = {
  episodeId: string
  number: number
  title: string
  chars: number
}

/** 哪幾集有正文可以整理。 */
export async function auditableEpisodes(projectId: string): Promise<EpisodeMaterial[]> {
  const rows = await db
    .select({
      episodeId: episodes.id,
      number: episodes.number,
      title: episodes.title,
      chars: chapters.charCount,
    })
    .from(episodes)
    .innerJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .innerJoin(chapters, eq(chapters.documentId, documents.id))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  /*
   * 一集可能有好幾章，所以同一集會出現好幾列——合併，字數相加。
   *
   * 現在每一集都只有一章，但「現在剛好只有一章」不是一個可以寫進查詢的假設。
   */
  const merged = new Map<string, EpisodeMaterial>()
  for (const row of rows) {
    const found = merged.get(row.episodeId)
    if (found) found.chars += row.chars
    else merged.set(row.episodeId, { ...row })
  }
  return [...merged.values()].filter((row) => row.chars > 0)
}

/* -------------------------------------------------------------------------- */

export type EpisodeAuditResult = {
  episodeId: string
  number: number
  title: string
  audit: EpisodeAudit | null
  problem: string | null
  model: string
  costUsd: number | null
}

/** 整理一集。 */
export async function auditEpisode(input: {
  projectId: string
  episodeId: string
  user: SessionUser
  /** 還留著的那幾條審核準則的索引；省略就是全部。 */
  rules?: readonly number[]
}): Promise<EpisodeAuditResult> {
  const [episode] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      targetSec: episodes.targetSec,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, input.episodeId),
        eq(episodes.projectId, input.projectId),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)
  if (!episode) throw ApiError.notFound('找不到這一集')

  const text = await novelText(episode.id)
  if (!text.trim()) throw ApiError.badRequest(`第 ${episode.number} 集還沒有正文`)

  const prior = await priorSummary(input.projectId, episode.number)
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)

  const result = await runNow({
    task: 'NOVEL_REVIEW',
    projectId: input.projectId,
    episodeId: episode.id,
    user: input.user,
    label: `編劇助手・第 ${episode.number} 集`,
    /*
     * **不要自己壓低輸出上限。**
     *
     * 第一版傳了 6000，而 `NOVEL_REVIEW` 這個任務本來的上限是 12000——
     * `effort: high` 的思考把那 6000 全部用完，一個字的內容都沒留下，而適配
     * 器正確地丟了「模型把輸出額度用在思考上」。省那幾千 token 的代價是整次
     * 呼叫作廢，而錢照付。
     *
     * 省略它，讓任務自己的設定生效（`TASK_MAX_TOKENS`／`TASK_EFFORT`），那
     * 一份是為這個任務調過的。
     */
    context: {
      ...(project?.title ? { projectTitle: project.title } : {}),
      episodeNumber: episode.number,
      ...(episode.title ? { episodeTitle: episode.title } : {}),
      targetSec: episode.targetSec,
      auditPass: 'audience',
      ...(prior ? { priorSummary: prior } : {}),
      sourceText: text,
      userInstruction: `${auditPersona(input.rules)}\n\n${AUDIT_INSTRUCTIONS.episode}`,
    },
  })

  const parsed = parseEpisodeAudit(result.text)
  return {
    episodeId: episode.id,
    number: episode.number,
    title: episode.title,
    audit: parsed.value,
    problem: parsed.problem,
    model: result.model,
    costUsd: result.costUsd,
  }
}

/* -------------------------------------------------------------------------- */

export type StoryDigestResult = {
  digest: StoryDigest | null
  problem: string | null
  model: string
  costUsd: number | null
  /** 這份整理是根據哪幾集算出來的。 */
  episodeNumbers: number[]
}

/** 整理主線與人設。 */
export async function digestStory(input: {
  projectId: string
  user: SessionUser
  rules?: readonly number[]
}): Promise<StoryDigestResult> {
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
  if (!project) throw ApiError.notFound('找不到這個作品')

  const rows = await db
    .select({
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      synopsis: episodes.synopsis,
    })
    .from(episodes)
    .where(and(eq(episodes.projectId, input.projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  const written = rows.filter((row) => row.logline.trim() || row.synopsis.trim())
  if (written.length === 0) {
    throw ApiError.badRequest('每一集都還沒有一句話或大綱，沒有東西可以整理。')
  }

  const cast = await db
    .select({ name: characters.name, tier: characters.tier })
    .from(characters)
    .where(and(eq(characters.projectId, input.projectId), isNull(characters.deletedAt)))
    .orderBy(asc(characters.name))

  const lines = written.map((row) => {
    const bits = [`第 ${row.number} 集${row.title ? `《${row.title}》` : ''}`]
    if (row.logline.trim()) bits.push(`一句話：${row.logline.trim()}`)
    if (row.synopsis.trim()) bits.push(`大綱：${row.synopsis.trim()}`)
    return bits.join('\n')
  })

  const result = await runNow({
    task: 'NOVEL_REVIEW',
    projectId: input.projectId,
    user: input.user,
    label: '編劇助手・主線與人設',
    /*
     * 摘要這一支不要用 high。
     *
     * 它讀的是二十條一句話與大綱，不是十萬字正文——要做的是歸納，不是推理。
     * `NOVEL_REVIEW` 預設的 high 會讓它想很久（實測等超過五分鐘還沒回），而
     * 多出來的那幾分鐘買到的東西，跟 medium 回的那一份差不多。
     */
    effort: 'medium',
    context: {
      projectTitle: project.title,
      auditPass: 'audience',
      ...(cast.length > 0
        ? { characters: cast.map((row) => ({ name: row.name, tier: row.tier })) }
        : {}),
      sourceText: lines.join('\n\n'),
      userInstruction: `${auditPersona(input.rules)}\n\n${AUDIT_INSTRUCTIONS.digest}`,
    },
  })

  const parsed = parseStoryDigest(result.text)
  return {
    digest: parsed.value,
    problem: parsed.problem,
    model: result.model,
    costUsd: result.costUsd,
    episodeNumbers: written.map((row) => row.number),
  }
}

/* -------------------------------------------------------------------------- */

export type AskResult = {
  answer: string
  model: string
  costUsd: number | null
}

/**
 * 問它一個問題。
 *
 * 報告是唯讀的，而讀完一定會有問題——「第 7 集這個爽點我覺得不夠」「馬大後來
 * 怎麼不見了」。沒有地方問的話，這一頁就只是一份印出來的紙。
 *
 * ## 材料是**已經算好的那一份**
 *
 * 它拿到的是主線整理與逐集的爽點鉤子，不是十萬字正文——那份整理就是為了這個
 * 才先算的。指定某一集的時候才額外附上那一集的全文，因為「這一句寫得不好」這
 * 種問題非看原文不可。
 *
 * ## 前幾輪也要帶
 *
 * 不帶的話「那這樣改呢？」會變成一個沒有主詞的問題。只帶最近幾輪：再往前的對
 * 話對當下這個問題幫助不大，而每一輪都要付錢。
 */
export async function askWriter(input: {
  projectId: string
  question: string
  /** 之前幾輪問答，由呼叫端保存。 */
  history?: readonly AskTurn[]
  /** 問題跟哪一集有關；給了就附上那一集全文。 */
  episodeId?: string | null
  /** 已經算好的整理，原樣帶進去當材料。 */
  material?: string
  rules?: readonly number[]
  user: SessionUser
}): Promise<AskResult> {
  const question = input.question.trim()
  if (!question) throw ApiError.badRequest('還沒有問題')

  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
  if (!project) throw ApiError.notFound('找不到這個作品')

  const parts: string[] = []
  if (input.material?.trim()) parts.push(`## 已經整理好的內容\n${input.material.trim()}`)

  let episodeNumber: number | undefined
  if (input.episodeId) {
    const [episode] = await db
      .select({ id: episodes.id, number: episodes.number, title: episodes.title })
      .from(episodes)
      .where(
        and(
          eq(episodes.id, input.episodeId),
          eq(episodes.projectId, input.projectId),
          isNull(episodes.deletedAt)
        )
      )
      .limit(1)
    if (!episode) throw ApiError.badRequest('指定的集數不屬於這個作品')

    const text = await novelText(episode.id)
    if (text.trim()) {
      episodeNumber = episode.number
      parts.push(
        `## 第 ${episode.number} 集${episode.title ? `《${episode.title}》` : ''}全文\n${text}`
      )
    }
  }

  const recent = (input.history ?? []).slice(-4)
  if (recent.length > 0) {
    parts.push(
      `## 先前的問答\n${recent.map((turn) => `Q：${turn.question}\nA：${turn.answer}`).join('\n\n')}`
    )
  }

  parts.push(`## 這次的問題\n${question}`)

  const result = await runNow({
    task: 'NOVEL_REVIEW',
    projectId: input.projectId,
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    user: input.user,
    label: episodeNumber ? `編劇助手・提問（第 ${episodeNumber} 集）` : '編劇助手・提問',
    /*
     * 問答不要用 high。
     *
     * 這裡多半是「這份材料裡寫了什麼」或「這樣改會動到哪幾集」，不是要重新推
     * 理整部戲。`high` 會把額度花在思考上然後回一句話——而那一句話跟 medium
     * 回的那一句差不多，價錢差很多。
     */
    effort: 'medium',
    context: {
      projectTitle: project.title,
      ...(episodeNumber !== undefined ? { episodeNumber } : {}),
      auditPass: 'audience',
      sourceText: parts.join('\n\n'),
      userInstruction: `${auditPersona(input.rules)}\n\n${AUDIT_INSTRUCTIONS.ask}`,
    },
  })

  return { answer: result.text.trim(), model: result.model, costUsd: result.costUsd }
}

/* -------------------------------------------------------------------------- */

/** 一集的正文，章節照順序接起來。 */
async function novelText(episodeId: string): Promise<string> {
  const rows = await db
    .select({ title: chapters.title, content: chapters.content })
    .from(chapters)
    .innerJoin(documents, eq(documents.id, chapters.documentId))
    .where(
      and(
        eq(documents.episodeId, episodeId),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .orderBy(asc(chapters.sortOrder))

  return rows
    .map((row) => {
      const body = stripHtmlToText(row.content).trim()
      return row.title ? `${row.title}\n${body}` : body
    })
    .join('\n\n')
}

/**
 * 此前已公開的劇情。
 *
 * **只取編號比這一集小的**，而且只取一句話與大綱不取正文：這一段是要讓模型知
 * 道觀眾看到這一集之前已經知道什麼。塞正文進去會讓每一集的請求越來越大，而且
 * 判斷「這一集的爽點」時並不需要前面每一個字。
 *
 * 取不到就回空字串，不要回「（無）」之類的字——那會讓模型以為前面是一片空白，
 * 而第一集本來就沒有前情。
 */
async function priorSummary(projectId: string, number: number): Promise<string> {
  const rows = await db
    .select({
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt),
        lt(episodes.number, number)
      )
    )
    .orderBy(asc(episodes.number))

  return rows
    .filter((row) => row.logline.trim())
    .map((row) => `第 ${row.number} 集${row.title ? `《${row.title}》` : ''}：${row.logline.trim()}`)
    .join('\n')
}
