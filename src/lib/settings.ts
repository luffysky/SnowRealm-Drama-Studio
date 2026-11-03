import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import {
  defaultModules,
  normaliseModules,
  type EditorModuleId,
  type EditorSurface,
} from '@/lib/editor/modules'
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
  editorModules: 'editor.modules',
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

/* -------------------------------------------------------------------------- */
/* Editor modules                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which editor modules are on, per surface.
 *
 * Installation-wide rather than per member: the two of them edit the same
 * documents, and an editor that produces headings for one and not the other
 * would make the prose depend on who typed it.
 */
export async function getEditorModules(surface: EditorSurface): Promise<EditorModuleId[]> {
  const stored = await readSetting(SETTING_KEYS.editorModules)

  if (stored && typeof stored === 'object') {
    const bySurface = (stored as Record<string, unknown>)[surface]
    if (Array.isArray(bySurface)) return normaliseModules(surface, bySurface)
  }

  return defaultModules(surface)
}

export async function setEditorModules(
  surface: EditorSurface,
  ids: readonly unknown[],
  userId: string
): Promise<EditorModuleId[]> {
  const stored = await readSetting(SETTING_KEYS.editorModules)
  const current =
    stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}

  const next = normaliseModules(surface, ids)
  await writeSetting(SETTING_KEYS.editorModules, { ...current, [surface]: next }, userId)
  return next
}
