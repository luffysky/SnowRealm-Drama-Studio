import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { finishUpload } from '@/lib/assets'
import { uploadCompleteSchema } from '@/lib/validators'

/**
 * Finalises the upload. The server HEADs the object in R2 before marking the
 * asset COMPLETED, so a browser that lied about finishing cannot leave a
 * broken asset in the library.
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('asset.upload')
  const input = await parseJson(request, uploadCompleteSchema)

  const asset = await finishUpload({
    user,
    uploadSessionId: input.uploadSessionId,
    ...(input.parts ? { parts: input.parts } : {}),
  })

  await logActivity({
    user,
    action: 'upload',
    entityType: 'asset',
    entityId: asset.id,
    projectId: asset.projectId,
    summary: `完成上傳「${asset.name}」`,
  })

  return jsonOk({ asset })
})
