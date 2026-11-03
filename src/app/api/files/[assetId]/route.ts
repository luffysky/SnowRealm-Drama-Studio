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
 *
 * `?variant=preview` serves the compressed copy (`docs/STORAGE.md`). It falls
 * back to the master when there is no preview, so a caller never has to know
 * whether one exists.
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ assetId: string }> }) => {
    const user = await requireUser()
    const { assetId } = await context.params

    const params = new URL(request.url).searchParams
    const asAttachment = params.get('download') === '1'
    /*
     * `?variant=preview` serves the small WebP/AVIF copy instead of the
     * master. Grids and cards ask for it; a download never does.
     */
    const preview = params.get('variant') === 'preview'

    const { url, expiresInSec, servedPreview } = await presignAssetDownload({
      user,
      assetId,
      asAttachment,
      preview,
    })

    return NextResponse.redirect(url, {
      status: 307,
      headers: {
        // Allow a brief private cache so a grid of thumbnails does not re-sign
        // the same object once per tile, but never allow a shared cache to
        // hold a URL that grants access.
        'Cache-Control': `private, max-age=${Math.max(0, Math.floor(expiresInSec / 2))}`,
        // Lets the caller tell whether it got the preview or fell back.
        'x-srds-variant': servedPreview ? 'preview' : 'master',
      },
    })
  }
)
