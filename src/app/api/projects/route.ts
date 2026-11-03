import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { createProject } from '@/lib/projects'
import { projectCreateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 新增作品 (Z63).
 *
 * `project.write` rather than `project.read`: creating a work lays out an arc
 * and up to 999 episodes with their stage rows, which is not something a
 * read-only member should be able to do.
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('project.write')

  const input = await parseJson(request, projectCreateSchema)
  const result = await createProject(user.id, input)

  await logActivity({
    user,
    action: 'create',
    entityType: 'project',
    entityId: result.id,
    projectId: result.id,
    summary: `建立作品《${input.title}》，共 ${result.episodeCount} 集`,
  })

  return jsonOk(result, { status: 201 })
})
