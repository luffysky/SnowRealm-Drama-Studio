import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { ApiError, handle, jsonOk, logActivity, requirePermission } from '@/lib/api'
import { listVendorModels } from '@/lib/ai/openai-compatible'
import { decryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'

/**
 * 跟廠商要可用的模型清單 (Z151).
 *
 * 模型名稱是這個領域變最快的東西，一份寫死的清單會在某天變成「選單裡有、
 * 打過去 404」。所以改成問廠商，結果存進 `available_models`——這樣清單永遠
 * 是**這個帳號當下真的能用的**，而不是某個人某天抄下來的。
 *
 * 七家有六家支援 `/models`。Gemini 的 OpenAI 相容層沒做這支（實測 404），
 * 回的訊息會直說要手動填，而不是假裝沒事。
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ providerId: string }> }) => {
    const user = await requirePermission('ai.provider.manage')
    const { providerId } = await context.params

    const [row] = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, providerId))
      .limit(1)

    if (!row) throw ApiError.notFound('找不到該 AI 供應商')
    if (row.kind !== 'OPENAI_COMPATIBLE') {
      throw ApiError.badRequest('只有 OpenAI 相容的供應商可以抓模型清單')
    }
    if (!row.baseUrl) throw ApiError.badRequest('這個供應商還沒有 base URL')

    const key =
      (row.apiKeyCiphertext ? decryptSecret(row.apiKeyCiphertext) : '') ||
      (row.envVarName ? (process.env[row.envVarName] ?? '') : '')

    if (!key) throw ApiError.badRequest('這個供應商還沒有金鑰，無法抓清單')

    const result = await listVendorModels({ baseUrl: row.baseUrl, apiKey: key })

    if (!result.ok) {
      /*
       * 200 帶著原因，不是 500。
       *
       * 「這一家沒有這支端點」是一個正常答案，而把它報成伺服器錯誤會讓真正
       * 的故障淹沒在雜訊裡。介面照這個原因告訴人要手動填。
       */
      return jsonOk({ fetched: false, reason: result.reason, models: row.availableModels ?? [] })
    }

    await db
      .update(aiProviders)
      .set({ availableModels: result.models, updatedAt: new Date() })
      .where(eq(aiProviders.id, providerId))

    await logActivity({
      user,
      action: 'update',
      entityType: 'ai_provider',
      entityId: providerId,
      summary: `${user.name} 抓到「${row.label}」的 ${result.models.length} 個模型`,
    })

    return jsonOk({ fetched: true, models: result.models })
  }
)
