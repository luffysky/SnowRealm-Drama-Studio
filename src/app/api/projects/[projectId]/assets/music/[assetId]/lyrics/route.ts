import { ApiError, handle, jsonOk, parseJson, requirePermission, requireUser } from '@/lib/api'
import { getMusic, saveLyrics } from '@/lib/music'
import { requireProjectApi } from '@/lib/project-access'
import { lyricsSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 存歌詞 (Z125).
 *
 * Its own endpoint rather than a field on the metadata form: timing a song is
 * its own sitting, and PATCHing the whole form on every pass would let a
 * timing save clobber a BPM somebody changed in another tab.
 */
export const PUT = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; assetId: string }> }
  ) => {
    const user = await requirePermission('asset.write')
    const { projectId, assetId } = await context.params

    // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, lyricsSchema)
    const result = await saveLyrics({ projectId, assetId, lyrics: input.lyrics, user })

    return jsonOk({ lyricsUpdatedAt: result.lyricsUpdatedAt.toISOString() })
  }
)

/**
 * 這一首的歌詞。
 *
 * Fetched per track rather than shipped with the whole library: the player's
 * queue is every finished track in the studio, and carrying every lyric sheet
 * in that payload would grow it for a panel showing one. It also means the
 * editor opens on what is in the database **now**, not on what was there when
 * the page was rendered — which matters when two people work on the same
 * track.
 */
export const GET = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; assetId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, assetId } = await context.params
    await requireProjectApi(projectId, user.id)

    const track = await getMusic(projectId, assetId)
    if (!track) throw ApiError.notFound('找不到這首曲子')

    return jsonOk({
      lyrics: track.lyrics,
      lyricsUpdatedAt: track.lyricsUpdatedAt?.toISOString() ?? null,
    })
  }
)
