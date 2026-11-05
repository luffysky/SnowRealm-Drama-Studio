import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { clearAssignment, setAssignment } from '@/lib/ai/assignments'
import { AI_JOB_KIND_LABEL, AI_JOB_KINDS, type AiJobKindValue } from '@/lib/constants'
import { modelAssignmentSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 哪個任務用哪個模型 (Z152).
 *
 * `model_assignments` 這張表一直都在，形狀也正好對，**零個呼叫端**——所以
 * 接了七家供應商也只會用到一家（`adapterForTask()` 挑第一個能用的）。
 *
 * `PUT` 設一個任務。`DELETE ?task=X` 清掉，清掉之後那個任務回到自動挑選。
 *
 * **沒有 GET**：清單由 `/ai` 那一頁在伺服器端呼叫 `listAssignments()` 渲染，
 * 所以一支 GET 只會是同一份查詢的第二個實作，外加一個要自己維護的授權面。
 * 寫完才被 `npm run check:api` 抓出來——它是對的。
 */
export const PUT = handle(async (request: Request) => {
  const user = await requirePermission('ai.provider.manage')
  const input = await parseJson(request, modelAssignmentSchema)

  /*
   * `nullish()` 讓 zod 收 undefined 也收 null，但存進去的時候兩者是同一件事：
   * 沒指定 (Z160)。明確轉成 null，不要讓 undefined 一路傳到 drizzle——那會
   * 變成「這一欄不要動」，而不是「把這一欄清成沒指定」。
   */
  await setAssignment({
    ...input,
    effort: input.effort ?? null,
    maxTokens: input.maxTokens ?? null,
  })

  await logActivity({
    user,
    action: 'update',
    entityType: 'model_assignment',
    entityId: null,
    summary: `${user.name} 把「${AI_JOB_KIND_LABEL[input.task] ?? input.task}」指派給 ${input.model}`,
  })

  return jsonOk({ task: input.task, model: input.model })
})

export const DELETE = handle(async (request: Request) => {
  const user = await requirePermission('ai.provider.manage')

  const task = new URL(request.url).searchParams.get('task') ?? ''
  if (!(AI_JOB_KINDS as readonly string[]).includes(task)) {
    // 比對過才刪。沒比對的話一個打錯的字會靜悄悄地什麼都沒刪，而畫面會說成功。
    return jsonOk({ cleared: false, reason: `不認得這個任務種類：${task}` })
  }

  await clearAssignment(task as AiJobKindValue)

  await logActivity({
    user,
    action: 'delete',
    entityType: 'model_assignment',
    entityId: null,
    summary: `${user.name} 取消了「${AI_JOB_KIND_LABEL[task as AiJobKindValue] ?? task}」的模型指派`,
  })

  return jsonOk({ cleared: true, task })
})
