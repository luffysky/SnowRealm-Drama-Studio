import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { approve, reject, requestApproval, unlock } from '@/lib/approvals'
import { requireProjectApi } from '@/lib/project-access'
import { documentProjectId } from '@/lib/reviews'
import { ApiError } from '@/lib/api'
import { approvalDecisionSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 定稿審核的四個動作 (Z41, design 58).
 *
 * 一支端點收四種動作而不是四支路由：它們改的是同一張表的同一條時間線，而
 * `approvals.ts` 已經把「哪一種狀態接得上哪一種」寫在裡面了（定稿之後不能再
 * 定稿、沒鎖的東西不能解鎖）。拆四支只會讓那些規則散開。
 *
 * **什麼都不改**：每一個動作都是插入一筆新紀錄，用 `supersedes_id` 指向被它
 * 取代的那一筆。所以誰鎖的、誰解的、為什麼解，全部留在紀錄上。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('document.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, approvalDecisionSchema)

    /*
     * 文件歸屬要另外檢查。
     *
     * 路由上的 `projectId` 只證明這個人進得了這部作品；`documentId` 是另一個
     * 參數，不比對的話，有 A 作品權限的人可以用 A 的網址把 B 作品的內容鎖起
     * 來——而鎖起來之後 B 的人會發現自己存不了檔，卻看不出是誰做的。
     */
    const owner = await documentProjectId(input.documentId)
    if (owner !== projectId) throw ApiError.notFound('這份文件不屬於這部作品')

    const common = {
      user,
      projectId,
      targetType: 'DOCUMENT' as const,
      targetId: input.documentId,
    }

    if (input.action === 'REQUEST') {
      const row = await requestApproval({ ...common, note: input.note })
      return jsonOk({ approval: row }, { status: 201 })
    }

    if (input.action === 'APPROVE') {
      /*
       * 沒有指定版本的時候，先把現在這份內容凍成一版 (Z41).
       *
       * `approve()` 要求釘住一個確切的 version id——定稿「目前那一版」在下一
       * 次存檔之後就失去意義了。問題是**章節存檔不會產生快照**（`versions`
       * 只在明確按「保留這一版」或刪章節備份時才長出來），所以實測這部作品
       * 的小說文件一份快照都沒有。
       *
       * 那就只剩兩條路：按鈕永遠是灰的並寫「還沒有版本快照」，或是定稿的時
       * 候自己做一份。後者才是「定稿」這兩個字的意思——把現在這份內容凍結
       * 起來。所以在這裡做，而且 label 寫明它是為了定稿做的。
       */
      let versionId = input.versionId
      if (!versionId) {
        const { snapshotDocument } = await import('@/lib/writing')
        const snapshot = await snapshotDocument({
          documentId: input.documentId,
          label: '定稿前快照',
          user,
        })
        versionId = snapshot.id
      }

      const row = await approve({ ...common, versionId, note: input.note })
      return jsonOk({ approval: row }, { status: 201 })
    }

    if (input.action === 'REJECT') {
      const row = await reject({ ...common, note: input.note })
      return jsonOk({ approval: row }, { status: 201 })
    }

    const row = await unlock({ ...common, reason: input.note })
    return jsonOk({ approval: row }, { status: 201 })
  }
)
