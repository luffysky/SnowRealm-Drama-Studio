import { NextResponse } from 'next/server'
import { ApiError, handle, requirePermission } from '@/lib/api'
import { exportNovel } from '@/lib/novel-export'
import { NOVEL_EXPORT_FORMATS, type NovelExportFormat } from '@/lib/novel-export-view'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

/**
 * 小說匯出.
 *
 *   ?format=txt|epub|markdown|html
 *   ?episodes=<id>,<id>        omitted means every episode
 *   ?empty=1                   keep episodes with no prose in them
 *   ?inline=1                  send without Content-Disposition
 *
 * A GET rather than a POST, so the whole thing is one `<a download>` and the
 * browser's own download manager handles a slow build — no blob held in a tab
 * that a refresh would lose.
 *
 * `inline=1` is what 一鍵複製 uses: the same text, read with `fetch` instead of
 * downloaded. One builder for both means the copied text and the exported file
 * can never drift apart.
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('project.read')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const params = new URL(request.url).searchParams

    const format = params.get('format') ?? 'txt'
    if (!(NOVEL_EXPORT_FORMATS as readonly string[]).includes(format)) {
      throw ApiError.badRequest(`不支援的格式：${format}`)
    }

    const episodeIds = (params.get('episodes') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)

    const file = await exportNovel(projectId, {
      format: format as NovelExportFormat,
      ...(episodeIds.length > 0 ? { episodeIds } : {}),
      includeEmpty: params.get('empty') === '1',
    })

    const inline = params.get('inline') === '1'

    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        'content-type': file.contentType,
        'content-length': String(file.body.length),
        ...(inline
          ? {}
          : {
              // RFC 5987: the plain `filename` is a fallback for clients that
              // cannot read the extended form, and a CJK title has nothing
              // ASCII to fall back to, hence the generic stem.
              'content-disposition': `attachment; filename="novel.${file.filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            }),
        // The book changes whenever anyone saves; a cached copy would hand
        // back yesterday's draft with no way to tell.
        'cache-control': 'no-store',
      },
    })
  }
)
