import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { beginUpload } from '@/lib/assets'
import { R2_LIMITS } from '@/lib/r2'
import { uploadRequestSchema } from '@/lib/validators'

/**
 * Step 1 of an upload: the server validates the request, creates a PENDING
 * asset, and returns a presigned destination.
 *
 * The browser then PUTs the bytes straight to R2 — they never pass through a
 * serverless function, which would hit both the request-size and duration
 * limits on a video file.
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('asset.upload')
  const input = await parseJson(request, uploadRequestSchema)

  const result = await beginUpload({
    user,
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    kind: input.kind,
    filename: input.filename,
    contentType: input.contentType ?? '',
    sizeBytes: input.sizeBytes,
    rootAssetId: input.rootAssetId ?? null,
    ...(input.linkTo ? { linkTo: input.linkTo } : {}),
  })

  await logActivity({
    user,
    action: 'upload',
    entityType: 'asset',
    entityId: result.assetId,
    projectId: input.projectId,
    summary: `開始上傳「${input.filename}」`,
  })

  return jsonOk({
    ...result,
    limits: {
      multipartThresholdBytes: R2_LIMITS.multipartThresholdBytes,
      partSizeBytes: R2_LIMITS.partSizeBytes,
    },
  })
})
