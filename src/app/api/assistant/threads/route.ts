import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { createThread } from '@/lib/assistant/threads'
import { assistantThreadCreateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 助理的對話串 (Z100).
 *
 * Scoped to the caller by `owner_id`, not by membership: an assistant thread
 * has exactly one member and listing 「我的對話」 is the whole point of the
 * column.
 *
 * **只有 POST。** 列清單由 `/assistant` 這一頁在伺服器端直接呼叫
 * `listThreads()` 渲染，所以這裡本來那支 GET 從來沒有人打過——它只是同一
 * 份查詢的第二個實作，外加一個要自己維護的授權面。拿掉 (Z146)。
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, assistantThreadCreateSchema)

  /*
   * `requireUser`, not `requirePermission('ai.run')`. Opening a thread costs
   * nothing; the run does, and that is where the permission is checked.
   */
  return jsonOk({ thread: await createThread(user.id, input.title) }, { status: 201 })
})
