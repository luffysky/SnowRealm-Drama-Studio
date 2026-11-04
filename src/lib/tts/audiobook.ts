import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { characters, episodes } from '@/db/schema'
import { ApiError } from '@/lib/api'
import { castChunks, castFromSpeakers, type CastMember } from '@/lib/narration'
import { novelForReading } from '@/lib/novel-export'
import { splitForSpeech } from '@/lib/speech-split'
import { batchChunks, billableChars, estimatedSeconds, ssmlFor, type SsmlBatch } from './ssml'

/**
 * 一集小說 → 可以送去合成的 SSML (Z129).
 *
 * 「這樣就可以直接做有聲小說影片」。整條路是：
 *
 *   正文 → 切段 → 分配角色與語氣 → 切成不超過單次上限的批次 → SSML
 *
 * 這個檔案做到 SSML 為止，**不碰網路**。合成是最後一步，而且是最容易看起來
 * 「做完了」其實錯了的一步：唸錯角色、語氣跑掉、某一段漏掉，都要聽完三十
 * 分鐘才會發現。所以能在送出之前算清楚的，全部在這裡算清楚。
 *
 * **切段與配音都重用閱讀器那一份**（`speech-split.ts` / `narration.ts`），
 * 不是另寫一套。兩套切法會讓同一個角色在閱讀器與匯出檔裡在不同地方開口，
 * 而那種不一致看起來就像「匯出壞掉了」。
 */

/** A voice as Azure lists it, reduced to what the caster needs. */
export type AudiobookVoice = { id: string; lang: string }

export type AudiobookCast = {
  name: string
  /** Null when the character got no voice — it reads in the narrator's. */
  voiceId: string | null
}

export type AudiobookPlan = {
  episodeNumber: number
  episodeTitle: string
  /** One per batch, each inside Azure's single-request output limit. */
  batches: SsmlBatch[]
  ssml: string[]
  chapters: { title: string; paragraphs: number }[]
  /** Characters billed for — markup is not charged. */
  billableChars: number
  estimatedSec: number
  /** Null when no rate is known. Never a guess presented as a quote. */
  estimatedCostUsd: number | null
  cast: AudiobookCast[]
  /** Named characters the prose never mentions in this episode. */
  unused: string[]
}

/**
 * Azure 標準神經語音的牌價，每百萬字元美金。
 *
 * Checked against Microsoft's pricing page rather than remembered. It is a
 * **default**, overridable per call, because a published price is a thing
 * that changes and a number baked into code is a number that goes stale
 * without anybody noticing (the same reason 匯率 and 模型單價 are settings).
 */
export const DEFAULT_RATE_PER_MILLION_USD = 15

export async function planEpisodeAudio(input: {
  projectId: string
  episodeId: string
  /** From `listVoices()`. Empty means everything reads as the narrator. */
  voices: AudiobookVoice[]
  narratorVoice: string
  locale?: string
  ratePerMillionUsd?: number | null
  /**
   * 段號 → 說話的人，從正文判斷出來的 (Z132).
   *
   * With it, dialogue gets a voice even for people the cast table has never
   * heard of — which is the whole point of 「從文本建音檔，音色又分開」.
   * Without it the rules decide, and on this novel the rules find nobody.
   */
  speakers?: ReadonlyMap<number, string>
}): Promise<AudiobookPlan> {
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

  if (!episode) throw ApiError.notFound('找不到這一集')

  /*
   * Reuses the reader's loader, then narrows to this episode. One place
   * decides what a paragraph is — the reader, the export and this have to
   * agree or the audio will not line up with the page it was made from.
   */
  const all = await novelForReading(input.projectId)
  const chapters = all.filter((chapter) => chapter.episodeId === input.episodeId)

  if (chapters.length === 0) {
    throw ApiError.badRequest('這一集還沒有小說內容')
  }

  const cast = await db
    .select({
      id: characters.id,
      name: characters.name,
      gender: characters.gender,
      tier: characters.tier,
    })
    .from(characters)
    .where(and(eq(characters.projectId, input.projectId), isNull(characters.deletedAt)))

  const members: CastMember[] = cast.map((row) => ({
    id: row.id,
    name: row.name,
    gender: row.gender ?? '',
    tier: row.tier,
  }))

  /*
   * The whole episode as one stream, not chapter by chapter.
   *
   * Attribution is decided per paragraph from the paragraph before it
   * (`speakerOf`), so restarting at every chapter boundary would lose who was
   * speaking across it — and a chapter break mid-conversation is normal in
   * this novel.
   */
  const paragraphs = chapters.flatMap((chapter) => chapter.paragraphs)
  const plain = splitForSpeech(paragraphs)

  /*
   * Everyone the prose actually gives a line to, whether or not the cast
   * table knows them. Falls back to the table alone when there is no
   * attribution, which is the behaviour this had before.
   */
  const castForVoices = input.speakers
    ? castFromSpeakers([...input.speakers.values()], members)
    : members

  const casted = castChunks(
    plain,
    paragraphs,
    castForVoices,
    input.voices,
    ...(input.speakers ? ([input.speakers] as const) : ([] as const))
  )

  const batches = batchChunks(casted)
  const locale = input.locale ?? 'zh-TW'

  const ssml = batches.map((batch) =>
    ssmlFor(batch.chunks, { locale, narratorVoice: input.narratorVoice })
  )

  const chars = billableChars(casted)
  const rate = input.ratePerMillionUsd ?? DEFAULT_RATE_PER_MILLION_USD

  /** Who actually speaks in this episode, and in whose voice. */
  const speaking = new Map<string, string | null>()
  for (const chunk of casted) {
    if (chunk.speaker) speaking.set(chunk.speaker, chunk.voiceId ?? null)
  }

  return {
    episodeNumber: episode.number,
    episodeTitle: episode.title,
    batches,
    ssml,
    chapters: chapters.map((chapter) => ({
      title: chapter.chapterTitle,
      paragraphs: chapter.paragraphs.length,
    })),
    billableChars: chars,
    estimatedSec: estimatedSeconds(casted),
    estimatedCostUsd: rate > 0 ? (chars / 1_000_000) * rate : null,
    cast: [...speaking.entries()].map(([name, voiceId]) => ({ name, voiceId })),
    /*
     * Listed because it is usually the interesting half: a named character
     * who never speaks in this episode is either correct or a sign the
     * attribution missed them, and only a person can tell which.
     */
    unused: members.map((m) => m.name).filter((name) => !speaking.has(name)),
  }
}
