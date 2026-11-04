import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { assets } from '@/db/schema'
import { ApiError, handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { speechStatus, transcribe, SpeechError } from '@/lib/azure/speech'
import { parseLyrics } from '@/lib/lyrics'
import { alignLyrics } from '@/lib/lyrics-align'
import { requireProjectApi } from '@/lib/project-access'
import { presignGet } from '@/lib/r2'
import { lyricsAlignSchema } from '@/lib/validators'

export const runtime = 'nodejs'
/** Transcribing a whole song takes longer than a default function slice. */
export const maxDuration = 60

/**
 * 用聽的幫歌詞標時間 (Z131).
 *
 * Transcribes the track, then aligns what was heard against the lyrics the
 * caller already has. **It proposes; it does not save.** The result goes back
 * to the tap-to-sync editor as a starting point with its confidence visible,
 * and nothing is written until somebody presses 儲存 there.
 *
 * That split matters: singing is hard for a recogniser, and a feature that
 * silently overwrote a timing pass somebody had done by hand would be worse
 * than not having it.
 */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; assetId: string }> }
  ) => {
    const user = await requirePermission('asset.write')
    const { projectId, assetId } = await context.params

    // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, lyricsAlignSchema)

    const parsed = parseLyrics(input.lyrics)
    if (parsed.lines.length === 0) {
      throw ApiError.badRequest('先貼上歌詞，才有東西可以對齊')
    }

    /*
     * Checked before the download. Fetching several megabytes from R2 to find
     * out the credential is wrong wastes the time and the bandwidth, and the
     * message it would produce would be about the wrong step.
     */
    const status = await speechStatus()
    if (!status.available) {
      throw new ApiError(503, status.detail, 'speech_unavailable')
    }

    const [asset] = await db
      .select({
        objectKey: assets.objectKey,
        name: assets.name,
        mimeType: assets.mimeType,
        kind: assets.kind,
        sizeBytes: assets.sizeBytes,
      })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId), isNull(assets.deletedAt)))
      .limit(1)

    if (!asset) throw ApiError.notFound('找不到這首曲子')
    if (asset.kind !== 'MUSIC') throw ApiError.badRequest('只有音樂可以對齊歌詞')

    const { url } = await presignGet({ objectKey: asset.objectKey })
    const download = await fetch(url)
    if (!download.ok) throw new ApiError(502, '讀不到音檔', 'audio_unreadable')

    const audio = Buffer.from(await download.arrayBuffer())

    try {
      const heard = await transcribe({
        audio,
        mimeType: asset.mimeType,
        fileName: asset.name,
      })

      const result = alignLyrics(parsed.lines, heard.words)

      return jsonOk({
        lines: result.lines,
        coverage: result.coverage,
        heard: result.heard,
        /** So the panel can say 「它只聽出 12 個字」 rather than just a ratio. */
        wordCount: heard.words.length,
        durationMs: heard.durationMs,
      })
    } catch (cause) {
      if (cause instanceof SpeechError) {
        throw new ApiError(cause.retryable ? 503 : 502, cause.message, 'speech_failed')
      }
      throw cause
    }
  }
)
