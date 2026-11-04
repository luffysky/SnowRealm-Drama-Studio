import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { createThread, listThreads } from '@/lib/assistant/threads'
import { assistantThreadCreateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 助理的對話串 (Z100).
 *
 * Scoped to the caller by `owner_id`, not by membership: an assistant thread
 * has exactly one member and listing 「我的對話」 is the whole point of the
 * column.
 */
export const GET = handle(async () => {
  const user = await requireUser()
  return jsonOk({ threads: await listThreads(user.id) })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, assistantThreadCreateSchema)

  /*
   * `requireUser`, not `requirePermission('ai.run')`. Opening a thread costs
   * nothing; the run does, and that is where the permission is checked.
   */
  return jsonOk({ thread: await createThread(user.id, input.title) }, { status: 201 })
})
