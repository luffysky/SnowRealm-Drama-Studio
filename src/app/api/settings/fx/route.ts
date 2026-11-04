import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { setFxRates } from '@/lib/settings'
import { fxRatesSchema } from '@/lib/validators'
import type { CurrencyValue } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * 匯率 (Z87).
 *
 * Typed in by hand rather than fetched: a studio of two people converting a
 * handful of totals does not need a rate feed, and a feed that quietly stops
 * updating is worse than a date on screen saying how old the number is. That
 * is what `asOf` is for, and why it is required.
 */
export const PUT = handle(async (request: Request) => {
  const user = await requirePermission('system.settings')
  const input = await parseJson(request, fxRatesSchema)

  await setFxRates(
    {
      base: input.base,
      rates: input.rates as Record<CurrencyValue, number>,
      asOf: input.asOf,
      source: input.source,
    },
    user.id
  )

  return jsonOk({ ok: true })
})
