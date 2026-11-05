import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '@/db'
import { aiJobs } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import { buildContext, estimateJob } from '@/lib/ai/jobs'
import { enqueueJob } from '@/lib/ai/queue'
import type { SessionUser } from '@/lib/auth/session'
import { getCharacter, updateCharacter, type CharacterRow } from '@/lib/characters'

/**
 * 角色設計與定妝 (Z70).
 *
 * `CHARACTER_DESIGN` 這個任務的 prompt、定價、佇列全都在，**介面上沒有任何
 * 地方按得到**——`scripts/check-ai-tasks.ts` 量出來的七個之一。
 *
 * ## 為什麼不是「加一顆按鈕」就好
 *
 * 加按鈕容易，但 `applyAiOutput()` 只認得三種 targetType，沒有角色。少了
 * 套用分支的話，採用會把任務標成已採用然後**什麼都沒寫**——`jobs.ts` 裡
 * 那段註解已經為對白歸屬講過同一件事：「說有寫入其實沒有」。
 *
 * 所以這個檔案是完整的一條線：建來源 → 問模型 → 解析 → 寫回角色。
 *
 * ## 輸出是結構化的
 *
 * 自由文字沒辦法programmatically 套用——「外觀提示詞與聲線建議」混在一段
 * 散文裡，誰也分不出哪一句要寫進 `visualPrompt`、哪一句要寫進 `voiceNote`。
 * 所以 `CHARACTER_DESIGN` 進了 `STRUCTURED_TASKS`，回 JSON。
 *
 * ## 不蓋掉作者自己寫的
 *
 * 只填**原本是空的**欄位。角色設定沒有版本歷史，所以蓋掉就是真的沒了——
 * 而這些欄位（外型、性格）正是作者最可能自己寫過的地方。要重生成就先把
 * 那一欄清空，那是一個明確的動作。
 */

/** 模型要回的四個欄位。全部可選——它可能只對其中幾項有把握。 */
export type CharacterDesign = {
  appearance: string
  visualPrompt: string
  negativePrompt: string
  voiceNote: string
}

/** 會被這個任務寫到的欄位，連帶它在介面上的名字。 */
export const DESIGN_FIELDS: { key: keyof CharacterDesign; label: string }[] = [
  { key: 'appearance', label: '外型 / 服裝 / 髮型' },
  { key: 'visualPrompt', label: '定妝提示詞' },
  { key: 'negativePrompt', label: '負面提示詞' },
  { key: 'voiceNote', label: '配音備註' },
]

/**
 * 把角色現有的設定寫成給模型看的材料。
 *
 * 刻意把**已經有的欄位也送進去**：模型要寫出跨集一致的定妝提示詞，就得知道
 * 這個角色現在長什麼樣、什麼性格。空的欄位標成「（未填）」而不是省略——
 * 省略看起來像沒有這個欄位，標出來才是在問它。
 */
export function characterSource(row: CharacterRow): string {
  const lines = [
    `姓名：${row.name}`,
    `定位：${row.tier}`,
    `身分／別名：${row.alias || '（未填）'}`,
    `性別：${row.gender || '（未填）'}`,
    `年齡：${row.age || '（未填）'}`,
    `性格：${row.personality || '（未填）'}`,
    `人物簡介：${row.background || '（未填）'}`,
    `成長弧線：${row.growth || '（未填）'}`,
    `現有外型：${row.appearance || '（未填）'}`,
    `現有定妝提示詞：${row.visualPrompt || '（未填）'}`,
  ]

  return lines.join('\n')
}

/**
 * 解析模型回來的 JSON。
 *
 * 寬鬆地找 JSON（模型偶爾會包在 ```json 裡），但**嚴格地檢查內容**：不是
 * 物件、四個欄位全空，都當作失敗。回一個「成功但四格空白」的結果，會讓
 * 採用按鈕寫入四個空字串，而那看起來就像它正常跑完了。
 */
export function parseCharacterDesign(text: string): CharacterDesign | null {
  if (!text?.trim()) return null

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()

  /*
   * 先照整段解析，解不開才退回「抓第一個 `{` 到最後一個 `}`」。
   *
   * 順序不能反。反過來的話，`[{...}]` 會被切出裡面那個物件然後當成成功——
   * 而模型回陣列通常表示它一次寫了好幾個角色，**取第一個等於隨便挑一個人
   * 的設定寫進這個角色**。那比解析失敗糟糕得多，因為它會成功。
   */
  let parsed: unknown = null

  try {
    parsed = JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(body.slice(start, end + 1))
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const row = parsed as Record<string, unknown>
  const pick = (key: string): string => {
    const value = row[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  const design: CharacterDesign = {
    appearance: pick('appearance'),
    visualPrompt: pick('visualPrompt'),
    negativePrompt: pick('negativePrompt'),
    voiceNote: pick('voiceNote'),
  }

  // 四格全空等於什麼都沒產出，那不是成功。
  if (DESIGN_FIELDS.every((field) => !design[field.key])) return null

  return design
}

/**
 * 只填空的欄位，回報填了哪些、跳過哪些。
 *
 * 分開成純函式是為了測得到：「不蓋掉作者寫的」這種保證，錯起來是**安靜地
 * 覆蓋**，而那在跑一次的時候看不出來——東西被換掉了，畫面上還是有字。
 */
export function mergeDesign(
  current: Pick<CharacterRow, 'appearance' | 'visualPrompt' | 'negativePrompt' | 'voiceNote'>,
  design: CharacterDesign
): { patch: Partial<CharacterDesign>; filled: string[]; kept: string[] } {
  const patch: Partial<CharacterDesign> = {}
  const filled: string[] = []
  const kept: string[] = []

  for (const field of DESIGN_FIELDS) {
    const existing = (current[field.key] ?? '').trim()
    const proposed = design[field.key]

    if (!proposed) continue

    if (existing) {
      kept.push(field.label)
      continue
    }

    patch[field.key] = proposed
    filled.push(field.label)
  }

  return { patch, filled, kept }
}

/* -------------------------------------------------------------------------- */
/* 排入任務                                                                    */
/* -------------------------------------------------------------------------- */

export async function enqueueCharacterDesign(input: {
  projectId: string
  characterId: string
  user: SessionUser
}): Promise<{ jobId: string; deduplicated: boolean; estimatedCostUsd: number | null }> {
  const row = await getCharacter(input.projectId, input.characterId)
  if (!row) throw ApiError.notFound('找不到這個角色')

  const context = await buildContext({
    projectId: input.projectId,
    episodeId: null,
    novelEpisodeId: null,
    sourceText: characterSource(row),
    userInstruction:
      `只回一個 JSON 物件，欄位：appearance（外型、服裝、髮型，中文敘述）、` +
      `visualPrompt（定妝提示詞，具體到可直接拿去生圖，跨集沿用同一張臉）、` +
      `negativePrompt（負面提示詞）、voiceNote（聲線建議）。` +
      `不要加任何其他欄位，不要在 JSON 以外寫說明。` +
      `已經填過的欄位請當成設定沿用，不要推翻。`,
    includeWorld: true,
    includeCharacters: false,
  })

  let estimatedCostUsd: number | null = null
  try {
    const estimate = await estimateJob({
      task: 'CHARACTER_DESIGN',
      providerId: null,
      candidates: 1,
      context,
    })
    estimatedCostUsd = estimate.estimatedCostUsd
  } catch {
    // 估不出來不該擋住排程；它只是資訊。
  }

  const { job, deduplicated } = await enqueueJob({
    user: input.user,
    task: 'CHARACTER_DESIGN',
    context,
    projectId: input.projectId,
    episodeId: null,
    providerId: null,
    candidates: 1,
    /*
     * 自己的 targetType。套用寫的是角色欄位，不是正文——讓它落到
     * `applyToDocument` 會把任務標成已採用然後什麼都沒寫。
     */
    targetType: 'character',
    targetId: input.characterId,
    idempotencyKey: crypto.randomUUID(),
    estimatedCostUsd,
  })

  await logActivity({
    user: input.user,
    action: 'ai.enqueue',
    entityType: 'character',
    entityId: input.characterId,
    projectId: input.projectId,
    summary: `${input.user.name} 替角色「${row.name}」排入設計與定妝`,
  })

  return { jobId: job.id, deduplicated, estimatedCostUsd }
}

/* -------------------------------------------------------------------------- */
/* 套用                                                                        */
/* -------------------------------------------------------------------------- */

export async function applyCharacterDesign(input: {
  jobId: string
  user: SessionUser
}): Promise<{ filled: string[]; kept: string[] }> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到這個任務')
  if (job.targetType !== 'character' || !job.targetId) {
    throw ApiError.badRequest('這個任務不是角色設計')
  }

  const result = job.result as { candidates?: { content?: string }[] } | null
  const content = result?.candidates?.[0]?.content ?? ''

  const design = parseCharacterDesign(content)
  if (!design) throw ApiError.badRequest('這次產出讀不出角色設定，沒有套用任何欄位')

  // 作品歸屬以任務上記的為準：`getCharacter` 已經用它把範圍限住了。
  const projectId = job.projectId ?? ''
  const row = await getCharacter(projectId, job.targetId)
  if (!row) throw ApiError.notFound('找不到這個角色')

  const { patch, filled, kept } = mergeDesign(row, design)

  if (filled.length > 0) {
    await updateCharacter({ projectId, characterId: row.id, patch })
  }

  await logActivity({
    user: input.user,
    action: 'ai.apply',
    entityType: 'character',
    entityId: row.id,
    projectId,
    summary:
      `${input.user.name} 採用了「${row.name}」的 AI 設計` +
      `（填了 ${filled.length} 欄${kept.length > 0 ? `，保留 ${kept.length} 欄原有內容` : ''}）`,
  })

  return { filled, kept }
}
