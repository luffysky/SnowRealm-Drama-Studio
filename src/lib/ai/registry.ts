import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { BUILT_IN_PRICING, createAnthropicAdapter } from './anthropic'
import { getModelPricing, getTaskProfiles } from '@/lib/settings'
import type { AiAdapter, AiTaskKind, MediaAdapter } from './types'

/**
 * Resolves a configured provider row into a live adapter.
 *
 * Image, video and TTS providers are not implemented yet — `adapterFor` returns
 * null for those kinds, which the UI renders as an explicit 不可用 state rather
 * than hiding the feature. Adding one means implementing `AiAdapter` and
 * registering it here; no caller changes.
 */

export type ProviderRow = typeof aiProviders.$inferSelect

function keyFor(row: ProviderRow): string | null {
  if (row.apiKeyCiphertext) {
    try {
      return decryptSecret(row.apiKeyCiphertext)
    } catch (error) {
      console.error(`[ai] failed to decrypt key for provider ${row.id}:`, error)
      return null
    }
  }
  if (row.envVarName) {
    return process.env[row.envVarName] ?? null
  }
  return null
}

/**
 * Rates and per-task settings from `app_settings`, merged over the built-in
 * tables.
 *
 * Fetched by the async callers and handed to `adapterFor`, which stays
 * synchronous: it is called from several places that are not async, and making
 * it await would push a database round trip into all of them.
 */
export async function aiOverrides(): Promise<AiOverrides> {
  const [pricing, taskProfiles] = await Promise.all([
    getModelPricing(BUILT_IN_PRICING),
    getTaskProfiles({}),
  ])
  return { pricing, taskProfiles }
}

export type AiOverrides = {
  pricing: Record<string, { input: number; output: number; cacheRead: number }>
  taskProfiles: Record<string, { model?: string; effort: 'low' | 'medium' | 'high' }>
}

export function adapterFor(row: ProviderRow, overrides?: AiOverrides): AiAdapter | null {
  switch (row.kind) {
    case 'ANTHROPIC':
      return createAnthropicAdapter({
        apiKey: keyFor(row),
        defaultModel: row.defaultModel || undefined,
        baseUrl: row.baseUrl || undefined,
        enabled: row.enabled,
        ...(overrides?.pricing ? { pricing: overrides.pricing } : {}),
        ...(overrides?.taskProfiles ? { taskProfiles: overrides.taskProfiles } : {}),
      })
    case 'IMAGE_GENERIC':
    case 'VIDEO_GENERIC':
    case 'TTS_GENERIC':
      // No adapter implemented yet; the caller shows 尚未支援.
      return null
    default:
      return null
  }
}

export async function loadProvider(providerId: string): Promise<{
  row: ProviderRow
  adapter: AiAdapter | null
} | null> {
  const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1)
  if (!row) return null
  return { row, adapter: adapterFor(row, await aiOverrides()) }
}

/**
 * Picks the provider that should serve `task`: the first enabled one whose
 * adapter supports it. Returns null when none is configured.
 */
export async function resolveAdapterForTask(task: AiTaskKind): Promise<{
  row: ProviderRow
  adapter: AiAdapter
} | null> {
  const rows = await db.select().from(aiProviders).where(eq(aiProviders.enabled, true))
  const overrides = await aiOverrides()

  for (const row of rows) {
    const adapter = adapterFor(row, overrides)
    if (!adapter) continue
    if (!adapter.supportedTasks.includes(task)) continue
    const status = await adapter.status()
    if (status.available) return { row, adapter }
  }

  return null
}

/**
 * Fallback adapter used when no provider row exists at all. Reads
 * ANTHROPIC_API_KEY directly, so the studio works before anyone opens the
 * provider settings dialog.
 */
export function envOnlyAnthropicAdapter(overrides?: AiOverrides): AiAdapter {
  return createAnthropicAdapter({
    ...(overrides?.pricing ? { pricing: overrides.pricing } : {}),
    ...(overrides?.taskProfiles ? { taskProfiles: overrides.taskProfiles } : {}),
  })
}

/**
 * The media adapter for a provider row, if one is implemented.
 *
 * Returns null for every kind today. That is the honest state: the enum
 * values exist, the queue knows how to drive them, and no vendor has been
 * wired up yet — so the UI says 「這類供應商尚未實作適配器」 rather than
 * offering a button that fails.
 *
 * Adding one means implementing `MediaAdapter` and returning it here. No
 * caller changes: the queue already handles submit, poll, timeout and cancel.
 */
export function mediaAdapterFor(row: ProviderRow): MediaAdapter | null {
  switch (row.kind) {
    case 'IMAGE_GENERIC':
    case 'VIDEO_GENERIC':
    case 'TTS_GENERIC':
      return null
    default:
      return null
  }
}

export async function loadMediaAdapter(providerId: string | null): Promise<MediaAdapter | null> {
  if (!providerId) return null
  const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1)
  return row ? mediaAdapterFor(row) : null
}
