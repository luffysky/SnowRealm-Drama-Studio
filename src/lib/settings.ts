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
  storageCost: 'cost.storage',
  modelPricing: 'cost.models',
  taskProfiles: 'ai.taskProfiles',
  iceServers: 'call.iceServers',
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

/* -------------------------------------------------------------------------- */
/* 會變動的費率與 AI 任務設定 (Z98)                                             */
/* -------------------------------------------------------------------------- */

/**
 * What storage costs.
 *
 * Cloudflare's published rate, which changes. Hardcoded, it meant the asset
 * centre's 「估算月費」 would quietly report the wrong number after a price
 * change, with nothing on screen to say so — hence `asOf`, which the UI shows
 * so an old quote is visibly old rather than silently wrong.
 */
export type StorageCost = {
  usdPerGbMonth: number
  freeTierGb: number
  /** ISO date the rate was taken from the provider's page. */
  asOf: string
  source: string
}

export const DEFAULT_STORAGE_COST: StorageCost = {
  usdPerGbMonth: 0.015,
  freeTierGb: 10,
  asOf: '2026-11-04',
  source: 'Cloudflare R2 Standard 公告價（尚未於系統設定更新）',
}

function parseStorageCost(value: unknown): StorageCost | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>

  const perGb = Number(c.usdPerGbMonth)
  const free = Number(c.freeTierGb)

  // A negative rate would make storing more files reduce the bill.
  if (!Number.isFinite(perGb) || perGb < 0) return null
  if (!Number.isFinite(free) || free < 0) return null

  return {
    usdPerGbMonth: perGb,
    freeTierGb: free,
    asOf: typeof c.asOf === 'string' ? c.asOf : DEFAULT_STORAGE_COST.asOf,
    source: typeof c.source === 'string' ? c.source : DEFAULT_STORAGE_COST.source,
  }
}

export async function getStorageCost(): Promise<StorageCost> {
  return parseStorageCost(await readSetting(SETTING_KEYS.storageCost)) ?? DEFAULT_STORAGE_COST
}

export async function setStorageCost(cost: StorageCost, userId: string): Promise<void> {
  const parsed = parseStorageCost(cost)
  if (!parsed) throw new Error('儲存費率的數值不合理')
  await writeSetting(SETTING_KEYS.storageCost, parsed, userId)
}

/* -------------------------------------------------------------------------- */

/** USD per million tokens, per model. */
export type ModelPrice = { input: number; output: number; cacheRead: number }
export type ModelPricing = Record<string, ModelPrice>

function parseModelPricing(value: unknown): ModelPricing | null {
  if (!value || typeof value !== 'object') return null

  const out: ModelPricing = {}

  for (const [modelId, price] of Object.entries(value as Record<string, unknown>)) {
    if (!modelId.trim() || !price || typeof price !== 'object') continue
    const p = price as Record<string, unknown>

    const input = Number(p.input)
    const output = Number(p.output)
    const cacheRead = Number(p.cacheRead)

    // Skip the row rather than reject the whole table: one malformed entry
    // added by hand should not make every other model's cost unknowable.
    if (![input, output, cacheRead].every((n) => Number.isFinite(n) && n >= 0)) continue

    out[modelId.trim()] = { input, output, cacheRead }
  }

  return Object.keys(out).length > 0 ? out : null
}

/**
 * Per-model rates, merged over the built-in table.
 *
 * Merged rather than replaced, so adding one new model to the setting does not
 * silently drop the prices of every model already in the ledger — a job run
 * last month must keep costing what it cost.
 */
export async function getModelPricing(fallback: ModelPricing): Promise<ModelPricing> {
  const stored = parseModelPricing(await readSetting(SETTING_KEYS.modelPricing))
  return stored ? { ...fallback, ...stored } : fallback
}

export async function setModelPricing(pricing: ModelPricing, userId: string): Promise<void> {
  const parsed = parseModelPricing(pricing)
  if (!parsed) throw new Error('模型單價沒有任何一列是有效的')
  await writeSetting(SETTING_KEYS.modelPricing, parsed, userId)
}

/* -------------------------------------------------------------------------- */

export const AI_EFFORTS = ['low', 'medium', 'high'] as const
export type AiEffort = (typeof AI_EFFORTS)[number]

/** Which model and how much deliberation each task gets. */
export type TaskProfile = { model?: string; effort: AiEffort }
export type TaskProfiles = Record<string, TaskProfile>

function parseTaskProfiles(value: unknown): TaskProfiles | null {
  if (!value || typeof value !== 'object') return null

  const out: TaskProfiles = {}

  for (const [task, profile] of Object.entries(value as Record<string, unknown>)) {
    if (!task.trim() || !profile || typeof profile !== 'object') continue
    const p = profile as Record<string, unknown>

    if (!AI_EFFORTS.includes(p.effort as AiEffort)) continue

    out[task.trim()] = {
      effort: p.effort as AiEffort,
      ...(typeof p.model === 'string' && p.model.trim() ? { model: p.model.trim() } : {}),
    }
  }

  return Object.keys(out).length > 0 ? out : null
}

/**
 * Per-task effort and model, merged over the built-in map.
 *
 * The built-in values are a judgement call, not a measurement — which is
 * exactly why they need to be overridable once there is real usage to judge
 * from.
 */
export async function getTaskProfiles(fallback: TaskProfiles): Promise<TaskProfiles> {
  const stored = parseTaskProfiles(await readSetting(SETTING_KEYS.taskProfiles))
  return stored ? { ...fallback, ...stored } : fallback
}

export async function setTaskProfiles(profiles: TaskProfiles, userId: string): Promise<void> {
  const parsed = parseTaskProfiles(profiles)
  if (!parsed) throw new Error('AI 任務設定沒有任何一列是有效的')
  await writeSetting(SETTING_KEYS.taskProfiles, parsed, userId)
}

/* -------------------------------------------------------------------------- */
/* 通話的 ICE 伺服器 (Z99)                                                      */
/* -------------------------------------------------------------------------- */

export type IceServer = {
  urls: string[]
  username?: string
  credential?: string
}

/**
 * STUN only, from Google's public servers.
 *
 * Enough for two ordinary home networks: STUN just tells each side what its
 * own public address looks like, and the browsers connect directly. It is not
 * enough for two symmetric NATs — some mobile carriers, most corporate
 * networks — where the traffic has to be relayed by a TURN server.
 *
 * No TURN is configured because one costs money and most calls do not need
 * it. When a call does fail for that reason, the panel says so with the
 * evidence, and the credentials go in here rather than in the source.
 */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

function parseIceServers(value: unknown): IceServer[] | null {
  if (!Array.isArray(value)) return null

  const out: IceServer[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>

    const urls = Array.isArray(row.urls)
      ? row.urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : typeof row.urls === 'string'
        ? [row.urls]
        : []

    // A server with no URL is not a server; skipping the row beats handing
    // the browser a malformed config it will reject wholesale.
    if (urls.length === 0) continue

    out.push({
      urls,
      ...(typeof row.username === 'string' && row.username ? { username: row.username } : {}),
      ...(typeof row.credential === 'string' && row.credential
        ? { credential: row.credential }
        : {}),
    })
  }

  return out.length > 0 ? out : null
}

export async function getIceServers(): Promise<IceServer[]> {
  return parseIceServers(await readSetting(SETTING_KEYS.iceServers)) ?? DEFAULT_ICE_SERVERS
}

export async function setIceServers(servers: IceServer[], userId: string): Promise<void> {
  const parsed = parseIceServers(servers)
  if (!parsed) throw new Error('至少要有一台有網址的伺服器')
  await writeSetting(SETTING_KEYS.iceServers, parsed, userId)
}
