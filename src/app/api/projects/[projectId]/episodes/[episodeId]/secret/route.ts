import { z } from 'zod'
import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { getSecret, setSecret } from '@/lib/ai/episode-secrets'

export const runtime = 'nodejs'

const bodySchema = z.object({ notes: z.string().max(20_000) })

/**
 * 編劇已確認的隱藏設定 (Z201).
 *
 * **單獨一支路由，不掛在集數那一支上。** 隱藏設定是劇透，而集數那一支的回應
 * 到處都在用——多一個欄位就等於多十幾個把它帶出去的地方。要拿到它必須明確地
 * 打這一支。
 */
export const GET = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('document.write')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    return jsonOk({ notes: await getSecret(projectId, episodeId) })
  }
)

export const PUT = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('document.write')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, bodySchema)
    await setSecret({ projectId, episodeId, notes: input.notes, user })

    return jsonOk({ ok: true })
  }
)
