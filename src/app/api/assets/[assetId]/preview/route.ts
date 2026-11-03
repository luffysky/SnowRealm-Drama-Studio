import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { beginVariantUpload, finishVariantUpload } from '@/lib/assets'
import { previewBeginSchema, previewCompleteSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * The compressed copy of an image (`docs/STORAGE.md`).
 *
 * POST presigns a single PUT — a preview is small by definition, so there is
 * no multipart path here. PATCH confirms the bytes landed, so nothing ever
 * points at an object that is not there.
 *
 * Producing the preview is the browser's job: it already holds the decoded
 * image, and a serverless function would have to download the master, decode
 * it and re-encode it inside a 60-second budget to achieve the same thing.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ assetId: string }> }) => {
    const user = await requirePermission('asset.upload')
    const { assetId } = await context.params
    const input = await parseJson(request, previewBeginSchema)

    return jsonOk(
      await beginVariantUpload({
        user,
        assetId,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        params: input.params ?? {},
      })
    )
  }
)

export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ assetId: string }> }) => {
    const user = await requirePermission('asset.upload')
    const { assetId } = await context.params
    const input = await parseJson(request, previewCompleteSchema)

    const variant = await finishVariantUpload({ user, assetId, variantId: input.variantId })

    return jsonOk({
      variantId: variant.id,
      sizeBytes: variant.sizeBytes,
      mimeType: variant.mimeType,
    })
  }
)
