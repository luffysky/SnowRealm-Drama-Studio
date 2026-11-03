import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import { DEFAULT_FX, isCurrency, type FxRates } from '@/lib/money'

/**
 * Reads and writes the `app_settings` key/value table.
 *
 * Every getter validates the stored shape and falls back to a documented
 * default rather than trusting whatever JSON happens to be in the row. A
 * setting edited by hand in the database should not be able to crash a page.
 */

export const SETTING_KEYS = {
  fxRates: 'fx.rates',
} as const

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)

  return row?.value ?? null
}

async function writeSetting(key: string, value: unknown, userId: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedById: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedById: userId, updatedAt: new Date() },
    })
}

/** Narrows unknown JSON to FxRates, or returns null when it does not fit. */
function parseFxRates(value: unknown): FxRates | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>

  if (!isCurrency(candidate.base)) return null
  if (!candidate.rates || typeof candidate.rates !== 'object') return null

  const rates = candidate.rates as Record<string, unknown>
  const parsed: Record<string, number> = {}

  for (const [code, rate] of Object.entries(rates)) {
    if (!isCurrency(code)) continue
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
    parsed[code] = rate
  }

  // Every currency the UI offers must have a rate, or a switch would throw.
  for (const code of Object.keys(DEFAULT_FX.rates)) {
    if (!(code in parsed)) return null
  }

  return {
    base: candidate.base,
    rates: parsed as FxRates['rates'],
    asOf: typeof candidate.asOf === 'string' ? candidate.asOf : DEFAULT_FX.asOf,
    source: typeof candidate.source === 'string' ? candidate.source : DEFAULT_FX.source,
  }
}

export async function getFxRates(): Promise<FxRates> {
  return parseFxRates(await readSetting(SETTING_KEYS.fxRates)) ?? DEFAULT_FX
}

export async function setFxRates(rates: FxRates, userId: string): Promise<void> {
  await writeSetting(SETTING_KEYS.fxRates, rates, userId)
}
