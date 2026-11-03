import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { setEditorModules } from '@/lib/settings'
import { editorModulesSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * Turns editor modules on and off for an editing surface.
 *
 * Installation-wide, so both members get the same editor. The payload is
 * normalised server-side: unknown ids are dropped and the locked modules are
 * forced back on, because a stored list that disabled paragraphs would leave
 * an editor nobody can type in.
 */
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, editorModulesSchema)

  const modules = await setEditorModules(input.surface, input.modules, user.id)
  return jsonOk({ surface: input.surface, modules })
})
