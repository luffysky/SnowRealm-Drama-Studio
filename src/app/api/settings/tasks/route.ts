import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { setTaskProfiles } from '@/lib/settings'
import { taskProfilesSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 每個 AI 任務用哪個模型、想多久 (Z87).
 *
 * The built-in values are a judgement call made before there was any usage to
 * judge from, which is exactly why they have to be changeable without a
 * deploy.
 */
export const PUT = handle(async (request: Request) => {
  const user = await requirePermission('system.settings')
  const { profiles } = await parseJson(request, taskProfilesSchema)

  await setTaskProfiles(profiles, user.id)
  return jsonOk({ ok: true })
})
