import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { setModelPricing } from '@/lib/settings'
import { modelPricingSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 模型單價 (Z87).
 *
 * USD per million tokens. Merged over the built-in table rather than replacing
 * it, so a model nobody has overridden keeps its known price instead of
 * becoming free.
 */
export const PUT = handle(async (request: Request) => {
  const user = await requirePermission('system.settings')
  const { pricing } = await parseJson(request, modelPricingSchema)

  await setModelPricing(pricing, user.id)
  return jsonOk({ ok: true })
})
