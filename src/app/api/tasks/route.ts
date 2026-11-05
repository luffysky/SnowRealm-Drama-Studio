import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createTask } from '@/lib/tasks'
import { taskCreateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 新增一個任務 (Z89).
 *
 * 跨作品的，所以路徑不在某一部作品底下——但**作品權限還是要檢查**：這支收
 * 一個 `projectId`，沒有檢查的話任何人都能往任何作品塞卡片。
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('task.write')
  const input = await parseJson(request, taskCreateSchema)

  await requireProjectApi(input.projectId, user.id)

  const created = await createTask({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    episodeNumber: input.episodeNumber ?? null,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    assigneeId: input.assigneeId ?? null,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    user,
  })

  return jsonOk(created, { status: 201 })
})
