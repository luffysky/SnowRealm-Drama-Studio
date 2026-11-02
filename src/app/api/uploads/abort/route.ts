import { z } from 'zod'
import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { abortUpload } from '@/lib/assets'

const schema = z.object({ uploadSessionId: z.string().uuid() })

/** Cancels an in-flight upload and aborts the R2 multipart upload. */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('asset.upload')
  const input = await parseJson(request, schema)

  await abortUpload({ user, uploadSessionId: input.uploadSessionId })

  return jsonOk({ ok: true })
})
