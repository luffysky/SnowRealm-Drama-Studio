import { ApiError, handle, jsonOk, parseJson, requirePermission, requireUser } from '@/lib/api'
import { speechStatus, voicePool } from '@/lib/azure/speech'
import { planEpisodeAudio } from '@/lib/tts/audiobook'
import { audiobookProgress, enqueueAudiobook } from '@/lib/tts/job'
import { requireProjectApi } from '@/lib/project-access'
import { audiobookSchema } from '@/lib/validators'

export const runtime = 'nodejs'
/** Planning reads every chapter and builds the SSML; not instant. */
export const maxDuration = 60

type Context = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 這一集的語音：目前跑到哪，以及試算 (Z129).
 *
 * `?plan=1` costs nothing and charges nothing — it builds the SSML and reports
 * the length, the cast and the price. 全 app 唯一一按就會花錢的另一個地方是
 * 批次生成，兩個都是先試算再送出，為同一個理由。
 */
export const GET = handle(async (request: Request, context: Context) => {
  const user = await requireUser()
  const { projectId, episodeId } = await context.params

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(projectId, user.id)

  const progress = await audiobookProgress(episodeId)
  const wantsPlan = new URL(request.url).searchParams.get('plan') === '1'

  if (!wantsPlan) return jsonOk({ progress })

  const status = await speechStatus()
  if (!status.available) {
    return jsonOk({ progress, speech: { available: false, detail: status.detail } })
  }

  const pool = await voicePool()
  const narrator = pool.find((voice) => voice.speaksChinese)?.id ?? ''

  const plan = await planEpisodeAudio({
    projectId,
    episodeId,
    voices: pool.map((voice) => ({
      id: voice.id,
      lang: voice.locale,
      gender: voice.gender,
      speaksChinese: voice.speaksChinese,
    })),
    narratorVoice: narrator,
  })

  return jsonOk({
    progress,
    speech: { available: true, detail: status.detail },
    plan: {
      episodeNumber: plan.episodeNumber,
      parts: plan.ssml.length,
      billableChars: plan.billableChars,
      estimatedSec: plan.estimatedSec,
      estimatedCostUsd: plan.estimatedCostUsd,
      cast: plan.cast,
      chapters: plan.chapters,
    },
    voices: pool.map((voice) => ({
      id: voice.id,
      label: voice.label,
      locale: voice.locale,
      gender: voice.gender,
      tier: voice.tier,
      styles: voice.styles.length,
    })),
  })
})

/** 排入合成。只排隊，不合成——合成在 worker 裡分好幾次做完。 */
export const POST = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('ai.run')
  const { projectId, episodeId } = await context.params
  await requireProjectApi(projectId, user.id)

  const input = await parseJson(request, audiobookSchema)

  const status = await speechStatus()
  if (!status.available) throw new ApiError(503, status.detail, 'speech_unavailable')

  const pool = await voicePool()
  const narrator =
    input.narratorVoice && pool.some((voice) => voice.id === input.narratorVoice)
      ? input.narratorVoice
      : (pool.find((voice) => voice.speaksChinese)?.id ?? '')

  if (!narrator) throw new ApiError(503, '這個區域沒有可用的中文音色', 'no_voice')

  const queued = await enqueueAudiobook({
    projectId,
    episodeId,
    voices: pool.map((voice) => ({
      id: voice.id,
      lang: voice.locale,
      gender: voice.gender,
      speaksChinese: voice.speaksChinese,
    })),
    narratorVoice: narrator,
    ...(input.locale ? { locale: input.locale } : {}),
    user,
  })

  return jsonOk(queued, { status: 202 })
})
