import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/lib/ai/anthropic'
import { encryptSecret, last4 } from '@/lib/crypto'
import { aiProviderSchema } from '@/lib/validators'

/*
 * **只有 POST** (Z146).
 *
 * 本來還有一支 GET 會列出供應商與它們的即時狀態，但 `/ai` 那一頁是伺服器
 * 元件，它自己查資料庫、自己問適配器——兩邊是同一段邏輯的兩份實作，而只有
 * 頁面那一份真的被用到。
 *
 * 金鑰從來不會回傳，只回後四碼（規格 48「金鑰僅後端加密保存，顯示遮罩」）。
 * 這件事兩份實作都做對了，但「兩份都要記得做對」本身就是一個遲早會破的
 * 約定。
 */

/** Creates a provider. The plaintext key is encrypted before it is stored. */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('ai.provider.manage')
  const input = await parseJson(request, aiProviderSchema)

  const [row] = await db
    .insert(aiProviders)
    .values({
      kind: input.kind,
      label: input.label,
      defaultModel: input.defaultModel || (input.kind === 'ANTHROPIC' ? DEFAULT_MODEL : ''),
      availableModels: input.kind === 'ANTHROPIC' ? [...AVAILABLE_MODELS] : [],
      ...(input.apiKey
        ? { apiKeyCiphertext: encryptSecret(input.apiKey), apiKeyLast4: last4(input.apiKey) }
        : {}),
      envVarName: input.envVarName ?? '',
      baseUrl: input.baseUrl ?? '',
      enabled: input.enabled ?? false,
    })
    .returning({ id: aiProviders.id, label: aiProviders.label })

  if (!row) throw new Error('Failed to create AI provider')

  await logActivity({
    user,
    action: 'create',
    entityType: 'ai_provider',
    entityId: row.id,
    summary: `新增 AI 供應商「${row.label}」`,
  })

  return jsonOk({ id: row.id }, { status: 201 })
})
