import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createShot } from '@/lib/storyboard'
import { shotSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 新增一個鏡頭 (Z39).
 *
 * `shotSchema` 本身帶 `episodeId`，而集數屬不屬於這部作品由 `createShot` 再
 * 檢查一次——路由上的 `projectId` 只證明這個人進得了這部作品，不證明他送來的
 * 那個 `episodeId` 也是這部作品的。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('episode.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, shotSchema)
    const { episodeId, ...rest } = input

    const shot = await createShot({
      projectId,
      episodeId,
      patch: {
        sceneCode: rest.sceneCode,
        durationSec: rest.durationSec,
        shotSize: rest.shotSize,
        camera: rest.camera,
        location: rest.location,
        timeOfDay: rest.timeOfDay,
        action: rest.action,
        dialogue: rest.dialogue,
        speakerId: rest.speakerId ?? null,
        prompt: rest.prompt,
        negativePrompt: rest.negativePrompt,
        status: rest.status,
        notes: rest.notes,
      },
      user,
    })

    return jsonOk({ shot }, { status: 201 })
  }
)
