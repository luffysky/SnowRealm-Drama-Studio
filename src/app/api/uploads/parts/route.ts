import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { presignUploadParts } from '@/lib/assets'
import { uploadPartsSchema } from '@/lib/validators'

/**
 * Presigns a batch of multipart part URLs. Called again for any part that
 * failed, which is what makes a large upload retryable without restarting.
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('asset.upload')
  const input = await parseJson(request, uploadPartsSchema)

  const parts = await presignUploadParts({
    user,
    uploadSessionId: input.uploadSessionId,
    partNumbers: input.partNumbers,
  })

  return jsonOk({ parts })
})
