import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { CURRENCIES, CURRENCY_LABEL } from '@/lib/money'
import { displayCurrencySchema } from '@/lib/validators'

/** Argon2id is not involved here, but the session lookup is — keep it on Node. */
export const runtime = 'nodejs'

/**
 * Changes which currency the signed-in member reads totals in.
 *
 * Display only: no stored amount is touched, and the preference is per member,
 * so one of them reading in USD does not change what the other sees.
 */
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  const { currency } = await parseJson(request, displayCurrencySchema)

  await db
    .update(users)
    .set({ displayCurrency: currency, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  return jsonOk({
    currency,
    label: CURRENCY_LABEL[currency],
    available: CURRENCIES,
  })
})
