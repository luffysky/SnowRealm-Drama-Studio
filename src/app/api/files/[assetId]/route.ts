import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { presignAssetDownload } from '@/lib/assets'

/**
 * The only way the browser reads a file out of the private bucket.
 *
 * The route checks the session and the asset's project **first**, then mints a
 * short-lived presigned GET and redirects to it. That keeps the bucket private
 * and unlistable while letting `<img src>` point at a stable application URL —
 * presigned URLs expire, so embedding one directly in markup would rot.
 *
 * `?download=1` sets Content-Disposition so the browser saves the file under
 * its original name instead of displaying it inline.
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ assetId: string }> }) => {
    const user = await requireUser()
    const { assetId } = await context.params

    const asAttachment = new URL(request.url).searchParams.get('download') === '1'

    const { url, expiresInSec } = await presignAssetDownload({
      user,
      assetId,
      asAttachment,
    })

    return NextResponse.redirect(url, {
      status: 307,
      headers: {
        // Allow a brief private cache so a grid of thumbnails does not re-sign
        // the same object once per tile, but never allow a shared cache to
        // hold a URL that grants access.
        'Cache-Control': `private, max-age=${Math.max(0, Math.floor(expiresInSec / 2))}`,
      },
    })
  }
)
