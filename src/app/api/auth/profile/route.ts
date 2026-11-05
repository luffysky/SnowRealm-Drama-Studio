import { handle, jsonOk, logActivity, parseJson, requirePermission, requireUser } from '@/lib/api'
import { updateProfile } from '@/lib/auth/profile'
import { profileUpdateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/*
 * **只有 PATCH。** 成員清單由 `/settings/profile` 在伺服器端直接呼叫
 * `listMembers()` 渲染，所以本來那支 GET 沒有任何呼叫端 (Z146)。
 */

/**
 * 改名字、Email、帳號、職稱、顏色、幣別。
 *
 * Your own always. Someone else's needs `member.manage`, which is OWNER-only
 * — a two-person studio needs one person able to fix the other's typo'd
 * email, or that account is locked out with nobody to ask.
 */
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, profileUpdateSchema)

  const targetId = input.userId ?? user.id

  if (targetId !== user.id) {
    await requirePermission('member.manage')
  }

  const { userId: _ignored, ...edit } = input
  const updated = await updateProfile(targetId, edit)

  await logActivity({
    user,
    action: 'update',
    entityType: 'user',
    entityId: targetId,
    summary:
      targetId === user.id
        ? '更新了自己的個人資料'
        : `更新了 ${updated.name} 的個人資料`,
  })

  return jsonOk({ member: updated })
})
