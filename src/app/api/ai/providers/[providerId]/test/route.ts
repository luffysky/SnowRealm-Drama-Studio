import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { ApiError, handle, jsonOk, requirePermission } from '@/lib/api'
import { loadProvider } from '@/lib/ai/registry'

/**
 * 連線測試 — makes the smallest real API call that still proves the key works
 * and the model is reachable, then records the outcome on the provider row.
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ providerId: string }> }) => {
    await requirePermission('ai.provider.manage')
    const { providerId } = await context.params

    const loaded = await loadProvider(providerId)
    if (!loaded) throw ApiError.notFound('找不到該 AI 供應商')

    if (!loaded.adapter) {
      const message = '這類供應商尚未實作適配器，無法測試。'
      await db
        .update(aiProviders)
        .set({ lastTestedAt: new Date(), lastTestOk: false, lastTestMessage: message })
        .where(eq(aiProviders.id, providerId))

      return jsonOk({ ok: false, message })
    }

    const result = await loaded.adapter.test()

    await db
      .update(aiProviders)
      .set({
        lastTestedAt: new Date(),
        lastTestOk: result.ok,
        lastTestMessage: result.message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(aiProviders.id, providerId))

    return jsonOk(result)
  }
)
