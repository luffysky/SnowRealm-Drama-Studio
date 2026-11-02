import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { createAnthropicAdapter } from './anthropic'
import type { AiAdapter, AiTaskKind } from './types'

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

export function adapterFor(row: ProviderRow): AiAdapter | null {
  switch (row.kind) {
    case 'ANTHROPIC':
      return createAnthropicAdapter({
        apiKey: keyFor(row),
        defaultModel: row.defaultModel || undefined,
        baseUrl: row.baseUrl || undefined,
        enabled: row.enabled,
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
  return { row, adapter: adapterFor(row) }
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

  for (const row of rows) {
    const adapter = adapterFor(row)
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
export function envOnlyAnthropicAdapter(): AiAdapter {
  return createAnthropicAdapter({})
}
