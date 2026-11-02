import { asc } from 'drizzle-orm'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { handle, jsonOk, logActivity, parseJson, requirePermission, requireUser } from '@/lib/api'
import { adapterFor } from '@/lib/ai/registry'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/lib/ai/anthropic'
import { encryptSecret, last4 } from '@/lib/crypto'
import { aiProviderSchema } from '@/lib/validators'

/**
 * Lists configured providers with their live availability.
 *
 * The API key is never returned — only its last four characters, so the UI can
 * show a masked value (spec 48「金鑰僅後端加密保存，顯示遮罩」).
 */
export const GET = handle(async () => {
  await requireUser()

  const rows = await db.select().from(aiProviders).orderBy(asc(aiProviders.createdAt))

  const providers = await Promise.all(
    rows.map(async (row) => {
      const adapter = adapterFor(row)
      const status = adapter
        ? await adapter.status()
        : ({
            available: false,
            reason: 'error',
            detail: '這類供應商尚未實作適配器。',
          } as const)

      return {
        id: row.id,
        kind: row.kind,
        label: row.label,
        defaultModel: row.defaultModel,
        availableModels: row.availableModels,
        enabled: row.enabled,
        /** Masked; the plaintext key never leaves the server. */
        apiKeyMasked: row.apiKeyLast4 ? `••••••••${row.apiKeyLast4}` : '',
        hasKey: Boolean(row.apiKeyCiphertext) || Boolean(row.envVarName),
        envVarName: row.envVarName,
        baseUrl: row.baseUrl,
        lastTestedAt: row.lastTestedAt,
        lastTestOk: row.lastTestOk,
        lastTestMessage: row.lastTestMessage,
        status,
        supportedTasks: adapter?.supportedTasks ?? [],
      }
    })
  )

  return jsonOk({
    providers,
    /** Shown when no provider row exists yet. */
    suggested: {
      kind: 'ANTHROPIC' as const,
      label: 'Claude（文字）',
      defaultModel: DEFAULT_MODEL,
      availableModels: AVAILABLE_MODELS,
      envVarName: 'ANTHROPIC_API_KEY',
    },
  })
})

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
