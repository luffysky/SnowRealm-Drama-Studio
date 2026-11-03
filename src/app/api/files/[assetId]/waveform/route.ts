import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { assetVariants } from '@/db/schema'
import { handle, requireUser } from '@/lib/api'
import { loadAssetForUser } from '@/lib/assets'
import { getObjectText } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * The peaks file for an audio asset (design 83, Z7).
 *
 * The bytes are proxied rather than redirected to a presigned URL, which is
 * the opposite of what `/api/files/[assetId]` does. Two reasons:
 *
 *  - `fetch()` on a presigned R2 URL is a cross-origin read, so it would need
 *    CORS configured on the bucket. `<audio src>` and `<img src>` do not, which
 *    is why the redirect works for them and not for this.
 *  - A peaks file is a few kilobytes. The bandwidth argument that makes
 *    redirecting right for a 50 MB track does not apply.
 *
 * 404 when there is no waveform. That is a normal state, not a failure: the
 * player falls back to the native controls, and the spec is explicit that it
 * must never draw peaks it does not have.
 */
export const GET = handle(
  async (_request: Request, context: { params: Promise<{ assetId: string }> }) => {
    const user = await requireUser()
    const { assetId } = await context.params

    // Permission first: this must not become a way to probe which asset ids
    // exist in someone else's project.
    await loadAssetForUser(assetId, user)

    const [variant] = await db
      .select({ objectKey: assetVariants.objectKey })
      .from(assetVariants)
      .where(
        and(
          eq(assetVariants.assetId, assetId),
          eq(assetVariants.kind, 'WAVEFORM'),
          eq(assetVariants.uploadStatus, 'COMPLETED')
        )
      )
      .limit(1)

    if (!variant) {
      return NextResponse.json(
        { error: { code: 'waveform_not_found', message: '這個素材沒有波形資料' } },
        { status: 404 }
      )
    }

    const body = await getObjectText(variant.objectKey)
    if (!body) {
      // The row says there is a waveform and the object is gone. Same outcome
      // for the player, but worth distinguishing in a log one day.
      return NextResponse.json(
        { error: { code: 'waveform_missing', message: '波形檔案不在儲存空間裡' } },
        { status: 404 }
      )
    }

    return new NextResponse(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Peaks never change for a given asset version, but the URL grants
        // access, so only the browser that asked may keep it.
        'cache-control': 'private, max-age=86400',
      },
    })
  }
)
