import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobs, assets, episodes } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { durationFromBytes } from '@/lib/azure/speech'
import { buildObjectKey, putObject } from '@/lib/r2'
import { planEpisodeAudio, type AudiobookCast, type AudiobookVoice } from './audiobook'
import { discardParts, joinParts, nextPartIndex, renderParts, renderSummary, type RenderedPart } from './render'
import { TTS_LIMITS } from './ssml'

/**
 * 一集小說 → 一個音檔 (Z129).
 *
 * 分次做完，因為非做不可：一集約三十分鐘的音檔，而 worker 的函式上限是 60
 * 秒。所以這個工作每次被叫到就在預算內盡量多做幾段，做完的立刻落地，下次從
 * 沒做的那一段接。全部做完才拼起來、存成素材。
 *
 * 它**不走文字適配器**——呼叫的是 Azure TTS，不是語言模型——所以在
 * `executeJob` 裡走自己的分支，不經過 `resolveAdapter`。
 */

/** What the job carries. Everything needed to resume without re-planning. */
export type AudiobookRequest = {
  kind: 'AUDIOBOOK'
  projectId: string
  episodeId: string
  episodeNumber: number
  narratorVoice: string
  locale: string
  /** One document per part, already inside Azure's single-request limit. */
  ssml: string[]
  /** Budgeted seconds per part, same order. */
  seconds: number[]
  billableChars: number
  estimatedCostUsd: number | null
  cast: AudiobookCast[]
}

export type AudiobookResult = {
  parts: RenderedPart[]
  /** Set once everything is rendered and stored. */
  assetId?: string
}

/**
 * How long one worker invocation spends rendering.
 *
 * The route allows sixty seconds; this leaves twenty for claiming the job,
 * writing progress, and — on the last pass — joining and uploading several
 * megabytes. Overrunning does not merely fail: the parts already rendered are
 * paid for and the function is killed before they are recorded.
 */
const RENDER_BUDGET_MS = 40_000

/* -------------------------------------------------------------------------- */

export async function enqueueAudiobook(input: {
  projectId: string
  episodeId: string
  voices: AudiobookVoice[]
  narratorVoice: string
  locale?: string
  /** 段號 → 說話的人, from the attribution pass. Optional. */
  speakers?: ReadonlyMap<number, string>
  /** 名字 → 男／女，給角色表沒有的人配性別相符的音色 (Z132)。 */
  genders?: ReadonlyMap<string, string>
  user: SessionUser
}): Promise<{ jobId: string; parts: number; estimatedSec: number; estimatedCostUsd: number | null }> {
  const plan = await planEpisodeAudio({
    projectId: input.projectId,
    episodeId: input.episodeId,
    voices: input.voices,
    narratorVoice: input.narratorVoice,
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.speakers ? { speakers: input.speakers } : {}),
    ...(input.genders ? { genders: input.genders } : {}),
  })

  if (plan.batches.length === 0) throw ApiError.badRequest('這一集沒有可以唸的內容')

  /*
   * One unfinished audiobook per episode. Without this, pressing the button
   * twice pays twice for the same thirty minutes — and the second job would
   * overwrite the first's parts, because the part keys are per job but the
   * asset is per episode.
   */
  const [running] = await db
    .select({ id: aiJobs.id, status: aiJobs.status })
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.episodeId, input.episodeId),
        eq(aiJobs.kind, 'NOVEL_TO_AUDIO'),
        isNull(aiJobs.finishedAt)
      )
    )
    .limit(1)

  if (running) {
    throw ApiError.badRequest('這一集已經有一個語音任務在跑，等它跑完或先取消。')
  }

  const request: AudiobookRequest = {
    kind: 'AUDIOBOOK',
    projectId: input.projectId,
    episodeId: input.episodeId,
    episodeNumber: plan.episodeNumber,
    narratorVoice: input.narratorVoice,
    locale: input.locale ?? 'zh-TW',
    ssml: plan.ssml,
    seconds: plan.batches.map((batch) => batch.estimatedSec),
    billableChars: plan.billableChars,
    estimatedCostUsd: plan.estimatedCostUsd,
    cast: plan.cast,
  }

  const [job] = await db
    .insert(aiJobs)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId,
      kind: 'NOVEL_TO_AUDIO',
      status: 'QUEUED',
      model: 'azure-tts',
      request,
      result: { parts: [] } satisfies AudiobookResult,
      targetType: 'episode_audio',
      targetId: input.episodeId,
      progressNote: `共 ${plan.ssml.length} 段，尚未開始`,
      ...(plan.estimatedCostUsd !== null
        ? { estimatedCost: String(plan.estimatedCostUsd) }
        : {}),
      requestedById: input.user.id,
    })
    .returning({ id: aiJobs.id })

  if (!job) throw new Error('Failed to queue audiobook job')

  await logActivity({
    user: input.user,
    action: 'ai.enqueue',
    entityType: 'episode',
    entityId: input.episodeId,
    projectId: input.projectId,
    summary:
      `${input.user.name} 把 EP${String(plan.episodeNumber).padStart(3, '0')} 排入語音合成` +
      `（${plan.ssml.length} 段，約 ${Math.round(plan.estimatedSec / 60)} 分鐘）`,
  })

  return {
    jobId: job.id,
    parts: plan.ssml.length,
    estimatedSec: plan.estimatedSec,
    estimatedCostUsd: plan.estimatedCostUsd,
  }
}

/* -------------------------------------------------------------------------- */

export type AudiobookStep = 'continuing' | 'succeeded'

/**
 * Renders as much as fits, then either stops for now or finishes.
 *
 * Returning `continuing` is not a failure and must not count as one: the
 * attempt counter and the backoff exist for things that went wrong, and a job
 * that rendered six of sixteen parts went right. It goes straight back to
 * `QUEUED` so the next worker pass picks it up.
 */
export async function advanceAudiobook(jobId: string): Promise<AudiobookStep> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1)
  if (!job) throw new Error('找不到這個任務')

  const request = job.request as AudiobookRequest
  const previous = (job.result as AudiobookResult | null) ?? { parts: [] }

  const step = await renderParts({
    jobId: job.id,
    ssml: request.ssml,
    seconds: request.seconds,
    done: previous.parts,
    budgetMs: RENDER_BUDGET_MS,
    onPart: async (parts) => {
      const summary = renderSummary(request.ssml.length, parts)
      await db
        .update(aiJobs)
        .set({
          result: { parts } satisfies AudiobookResult,
          progress: Math.min(99, summary.percent),
          progressNote: `已合成 ${summary.done} / ${summary.total} 段`,
          lockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiJobs.id, job.id))
    },
  })

  if (!step.complete) {
    const summary = renderSummary(request.ssml.length, step.parts)
    await db
      .update(aiJobs)
      .set({
        status: 'QUEUED',
        result: { parts: step.parts } satisfies AudiobookResult,
        progress: Math.min(99, summary.percent),
        progressNote: `已合成 ${summary.done} / ${summary.total} 段，稍後繼續`,
        // Released so the next pass can claim it immediately.
        lockedAt: null,
        lockedBy: '',
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiJobs.id, job.id))

    return 'continuing'
  }

  /* ---- everything rendered: stitch, store, link ----------------------- */

  const audio = await joinParts(step.parts)
  const summary = renderSummary(request.ssml.length, step.parts)

  const filename = `EP${String(request.episodeNumber).padStart(3, '0')}_有聲書.mp3`
  const objectKey = buildObjectKey({
    projectId: request.projectId,
    kind: 'VOICE',
    filename,
    episodeNumber: request.episodeNumber,
  })

  await putObject({ objectKey, body: audio, contentType: 'audio/mpeg' })

  const [asset] = await db
    .insert(assets)
    .values({
      projectId: request.projectId,
      episodeId: request.episodeId,
      kind: 'VOICE',
      origin: 'LIBRARY',
      name: filename,
      title: `EP${String(request.episodeNumber).padStart(3, '0')} 有聲書`,
      objectKey,
      mimeType: 'audio/mpeg',
      sizeBytes: audio.length,
      /*
       * 從實際位元組算，不是從預估 (Z138).
       *
       * `summary.sec` 是合成**前**用「字數 ÷ 每秒 3.9 字」估的，那是用來
       * 切批次的預算。拿它當長度短了 9%——播放器說 15:01，素材庫寫 13 分
       * 42 秒，而使用者兩個都看得到。
       */
      durationSec: Math.round(durationFromBytes(audio.length)),
      /*
       * 這一筆自己說自己是什麼 (Z147).
       *
       * 「這一集有沒有聲音」本來靠 `kind = 'VOICE'` ＋ 有 `episode_id` 判
       * 斷，而那些條件**手上傳的檔案也全部符合**——集數素材頁的可上傳清單裡
       * 就有 VOICE，而它的上傳帶著 `episodeId`。於是一段三秒的參考音會把真
       * 正的成品頂掉（查詢取最新的那一個）。
       *
       * 修在這裡而不是在查詢裡疊條件：查詢只能猜（檔名？標題？時長？），而
       * 這裡知道答案。既有的兩筆由 `drizzle/0034_audiobook_marker.sql` 從
       * `ai_jobs.result.assetId` 補標記。
       */
      generationMeta: {
        source: 'NOVEL_TO_AUDIO',
        kind: 'AUDIOBOOK',
        jobId: job.id,
        voice: request.narratorVoice,
        locale: request.locale,
        parts: request.ssml.length,
      },
      uploadStatus: 'COMPLETED',
      ...(job.requestedById ? { uploadedById: job.requestedById } : {}),
    })
    .returning({ id: assets.id })

  if (!asset) throw new Error('Failed to store the audiobook asset')

  /*
   * Only once the asset row exists. A crash between the upload and this
   * insert leaves an orphan object, which the upload sweeper collects —
   * whereas a row pointing at nothing is a track that cannot be played.
   */
  await discardParts(step.parts)

  await db
    .update(aiJobs)
    .set({
      status: 'SUCCEEDED',
      result: { parts: step.parts, assetId: asset.id } satisfies AudiobookResult,
      progress: 100,
      progressNote: `完成，${Math.round(summary.sec / 60)} 分鐘`,
      appliedVersionId: null,
      lockedAt: null,
      lockedBy: '',
      finishedAt: new Date(),
      updatedAt: new Date(),
      /*
       * Billed per character, not per token. The estimate was computed from
       * the same count, so the two are comparable in 製片中心 — which is the
       * only reason to record it here rather than leaving it null.
       */
      ...(request.estimatedCostUsd !== null
        ? { actualCost: String(request.estimatedCostUsd) }
        : {}),
    })
    .where(eq(aiJobs.id, job.id))

  return 'succeeded'
}

/** Whether a job row is one of these. Used by the queue's dispatch. */
export function isAudiobookJob(job: { kind: string }): boolean {
  return job.kind === 'NOVEL_TO_AUDIO'
}

/** For the UI: how far along, without loading the SSML. */
export async function audiobookProgress(episodeId: string): Promise<{
  jobId: string
  status: string
  done: number
  total: number
  percent: number
  assetId: string | null
  note: string
} | null> {
  const [job] = await db
    .select({
      id: aiJobs.id,
      status: aiJobs.status,
      request: aiJobs.request,
      result: aiJobs.result,
      progressNote: aiJobs.progressNote,
    })
    .from(aiJobs)
    .where(and(eq(aiJobs.episodeId, episodeId), eq(aiJobs.kind, 'NOVEL_TO_AUDIO')))
    .orderBy(aiJobs.createdAt)
    .limit(1)

  if (!job) return null

  const request = job.request as AudiobookRequest
  const result = (job.result as AudiobookResult | null) ?? { parts: [] }
  const summary = renderSummary(request.ssml?.length ?? 0, result.parts)

  return {
    jobId: job.id,
    status: job.status,
    done: summary.done,
    total: summary.total,
    percent: summary.percent,
    assetId: result.assetId ?? null,
    note: job.progressNote,
  }
}

/** Exposed so the UI can say 「一段大約兩分鐘」 without duplicating the number. */
export const AUDIOBOOK_LIMITS = TTS_LIMITS

/** Re-exported for callers that only need to know whether anything is left. */
export { nextPartIndex }

/** Makes sure an episode has prose before anything is charged for. */
export async function audiobookEligible(
  projectId: string,
  episodeId: string
): Promise<{ ok: boolean; reason?: string }> {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)

  if (!episode) return { ok: false, reason: '找不到這一集' }
  return { ok: true }
}
