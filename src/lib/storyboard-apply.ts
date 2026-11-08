import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobs, characters, episodes, shots } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import {
  CAMERA_MOVES,
  SHOT_SIZES,
  type CameraMoveValue,
  type ShotSizeValue,
} from '@/lib/constants'

/**
 * 把 AI 分鏡的輸出讀成鏡頭 (Z71).
 *
 * `STORYBOARD_GENERATE` 的 prompt、定價、批次入口都在，而它產出的東西
 * **沒有任何地方能套用**——`applyCandidate` 沒有這個分支，所以採用會把任務標
 * 成已採用然後一個鏡頭都沒建。Z123 的「說有寫入其實沒有」換一個殼。
 *
 * ## 解析失敗要像失敗
 *
 * 讀不出來就丟錯，不要建一堆空白鏡頭。空白鏡頭在畫面上看起來就像「生成好
 * 了，只是內容是空的」，而那比報錯難追十倍——Z70 角色設計那一條就是這樣被
 * 抓到的。
 */

export type ShotDraft = {
  sceneCode: string
  durationSec: number
  shotSize: ShotSizeValue
  camera: CameraMoveValue
  location: string
  timeOfDay: string
  action: string
  dialogue: string
  /** 角色名稱，對應 id 的工作留給寫入端——純函式不查資料庫。 */
  speaker: string | null
  prompt: string
  negativePrompt: string
}

export type ParsedShots = {
  shots: ShotDraft[]
  /** 讀不出來的，連同原因。 */
  rejected: string[]
}

function unwrap(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

/** 裸陣列，或物件裡唯一的陣列屬性——相容層的 json_object 模式會包一層。 */
function arrayIn(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  const arrays = Object.values(value as Record<string, unknown>).filter(Array.isArray)
  return arrays.length === 1 ? (arrays[0] as unknown[]) : null
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function parseShotTable(text: string): ParsedShots {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrap(text))
  } catch {
    return { shots: [], rejected: ['整段讀不出 JSON'] }
  }

  const rows = arrayIn(parsed)
  if (!rows) return { shots: [], rejected: ['JSON 裡找不到鏡頭清單'] }

  const out: ShotDraft[] = []
  const rejected: string[] = []

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejected.push(`第 ${index + 1} 筆不是物件`)
      return
    }

    const item = row as Record<string, unknown>

    /*
     * 秒數必須是正整數。
     *
     * 這一欄是總長校驗的分母——讀成 0 或 NaN 會讓「加起來剛好 150 秒」這句話
     * 變成算錯的結果，而那正是這一整頁存在的理由。所以寧可退回這一筆。
     */
    const rawDuration = item.durationSec
    const durationSec =
      typeof rawDuration === 'number'
        ? Math.round(rawDuration)
        : typeof rawDuration === 'string' && /^\d+(\.\d+)?$/.test(rawDuration.trim())
          ? Math.round(Number(rawDuration))
          : 0

    if (durationSec <= 0) {
      rejected.push(`第 ${index + 1} 筆的秒數讀不出來：${String(rawDuration ?? '（沒寫）')}`)
      return
    }

    const rawSize = str(item.shotSize, 20).toUpperCase()
    const rawCamera = str(item.camera, 20).toUpperCase()

    out.push({
      sceneCode: str(item.sceneCode, 40),
      durationSec,
      // 讀不出來的落在預設值而不是退回整筆：景別猜錯改一個下拉就好，秒數猜
      // 錯則會讓總長失真——兩者的代價差很多。
      /*
       * 只收**內建**的那幾個，不管使用者自己加了什麼 (Z184).
       *
       * 模型拿到的提示詞裡列的就是內建那八個（`prompts.ts`），所以它回別的東
       * 西一律是猜的。把自訂值也收進來的話，一個叫 `CU2` 的自訂景別會讓模型
       * 偶然吐出的 `CU2` 變成「有效」——而那不是人教它的，是碰巧撞上。
       */
      shotSize: (SHOT_SIZES as readonly string[]).includes(rawSize)
        ? (rawSize as ShotSizeValue)
        : 'MS',
      camera: (CAMERA_MOVES as readonly string[]).includes(rawCamera)
        ? (rawCamera as CameraMoveValue)
        : 'STATIC',
      location: str(item.location, 200),
      timeOfDay: str(item.timeOfDay, 40),
      action: str(item.action, 4000),
      dialogue: str(item.dialogue, 4000),
      speaker: str(item.speaker, 80) || null,
      prompt: str(item.prompt, 4000),
      negativePrompt: str(item.negativePrompt, 2000),
    })
  })

  return { shots: out, rejected }
}

/**
 * 把一個已完成的分鏡任務寫成鏡頭。
 *
 * **接在既有鏡頭後面，不清空**。清空等於把人手改過的鏡頭一次抹掉，而
 * `shots` 沒有版本快照——抹掉就是真的沒了。要重來的話，人自己刪。
 */
export async function applyStoryboard(input: {
  jobId: string
  user: SessionUser
}): Promise<{ created: number; rejected: string[] }> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到該 AI 任務')
  if (!job.episodeId) throw ApiError.badRequest('這個分鏡任務沒有綁定集數，無法套用')

  const result = job.result as { candidates?: { content: string }[] } | null
  const content = result?.candidates?.[0]?.content ?? ''

  const parsed = parseShotTable(content)
  if (parsed.shots.length === 0) {
    throw ApiError.badRequest(
      `讀不出任何鏡頭，所以沒有寫入任何東西。${parsed.rejected[0] ?? ''}`
    )
  }

  const [episode] = await db
    .select({ id: episodes.id, projectId: episodes.projectId, number: episodes.number })
    .from(episodes)
    .where(eq(episodes.id, job.episodeId))
    .limit(1)

  if (!episode) throw ApiError.notFound('找不到這一集')

  // 角色名稱 → id。對不上就留 null：配音是另一條路，掛錯人比沒掛更難發現。
  const cast = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(and(eq(characters.projectId, episode.projectId), isNull(characters.deletedAt)))

  const byName = new Map(cast.map((row) => [row.name.trim(), row.id]))

  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${shots.order}), 0)` })
    .from(shots)
    .where(eq(shots.episodeId, episode.id))

  let order = Number(last?.max ?? 0)

  const values = parsed.shots.map((draft) => {
    order += 1
    return {
      episodeId: episode.id,
      order,
      sceneCode: draft.sceneCode,
      durationSec: draft.durationSec,
      shotSize: draft.shotSize,
      camera: draft.camera,
      location: draft.location,
      timeOfDay: draft.timeOfDay,
      action: draft.action,
      dialogue: draft.dialogue,
      speakerId: draft.speaker ? (byName.get(draft.speaker) ?? null) : null,
      prompt: draft.prompt,
      negativePrompt: draft.negativePrompt,
      // 提示詞寫好了但還沒生圖——這正是 PROMPT_READY 的意思。
      status: draft.prompt ? ('PROMPT_READY' as const) : ('TODO' as const),
    }
  })

  await db.insert(shots).values(values)

  await db
    .update(aiJobs)
    .set({
      status: 'SUCCEEDED',
      appliedById: input.user.id,
      appliedAt: new Date(),
      progressNote: `已套用，建立了 ${values.length} 個鏡頭`,
      updatedAt: new Date(),
    })
    .where(eq(aiJobs.id, job.id))

  await logActivity({
    user: input.user,
    action: 'ai.apply',
    entityType: 'shot',
    entityId: episode.id,
    projectId: episode.projectId,
    summary: `套用 AI 分鏡：第 ${episode.number} 集新增 ${values.length} 個鏡頭`,
  })

  return { created: values.length, rejected: parsed.rejected }
}
