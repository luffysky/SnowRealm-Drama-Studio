import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { assets, characterRelationships, characters, episodeCharacters, episodes } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import type { CharacterTierValue } from '@/lib/constants'

/**
 * 角色資料庫 (designs 10, 11).
 *
 * A character here is the thing every later stage points at: the storyboard
 * reuses `visualPrompt` so the face stays the same across 120 episodes, and
 * voice work reuses `voiceId`. That is why the record is deliberately more
 * than a name and a portrait.
 */

export type CharacterRow = {
  id: string
  name: string
  alias: string
  tier: CharacterTierValue
  age: string
  gender: string
  appearance: string
  personality: string
  background: string
  growth: string
  visualPrompt: string
  negativePrompt: string
  voiceProvider: string
  voiceId: string
  voiceStyle: string
  voiceNote: string
  keyVisualAssetId: string | null
  voiceSampleAssetId: string | null
  updatedAt: Date
  /** How many episodes this character is tagged into. */
  episodeCount: number
}

export type RelationshipRow = {
  id: string
  fromCharacterId: string
  toCharacterId: string
  fromName: string
  toName: string
  kind: string
  description: string
  sentiment: number
  fromEpisodeNumber: number | null
  toEpisodeNumber: number | null
}

export type CharacterOverview = {
  characters: CharacterRow[]
  relationships: RelationshipRow[]
  countsByTier: Record<string, number>
  total: number
}

export type CharacterFilters = {
  tier?: CharacterTierValue
  search?: string
}

export async function getCharacters(
  projectId: string,
  filters: CharacterFilters = {}
): Promise<CharacterOverview> {
  const scope = and(eq(characters.projectId, projectId), isNull(characters.deletedAt))!

  const conditions = [scope]
  if (filters.tier) conditions.push(eq(characters.tier, filters.tier))

  const search = filters.search?.trim()
  if (search) {
    const like = `%${search}%`
    conditions.push(
      or(
        ilike(characters.name, like),
        ilike(characters.alias, like),
        ilike(characters.personality, like),
        ilike(characters.background, like)
      )!
    )
  }

  const [rows, counts, totals] = await Promise.all([
    db
      .select()
      .from(characters)
      .where(and(...conditions))
      .orderBy(
        // Leads first, then by name: the pair look for 男主/女主 before anyone.
        sql`case ${characters.tier}
              when 'LEAD' then 0
              when 'SUPPORTING' then 1
              when 'MINOR' then 2
              else 3
            end`,
        asc(characters.name)
      ),

    // Unfiltered, so the tier pills keep showing real totals.
    db
      .select({ tier: characters.tier, n: count() })
      .from(characters)
      .where(scope)
      .groupBy(characters.tier),

    db.select({ n: count() }).from(characters).where(scope),
  ])

  const ids = rows.map((r) => r.id)

  const [appearances, relationshipRows] = await Promise.all([
    ids.length
      ? db
          .select({ characterId: episodeCharacters.characterId, n: count() })
          .from(episodeCharacters)
          .innerJoin(episodes, eq(episodes.id, episodeCharacters.episodeId))
          .where(
            and(
              inArray(episodeCharacters.characterId, ids),
              isNull(episodes.deletedAt)
            )
          )
          .groupBy(episodeCharacters.characterId)
      : Promise.resolve([]),

    db
      .select({
        id: characterRelationships.id,
        fromCharacterId: characterRelationships.fromCharacterId,
        toCharacterId: characterRelationships.toCharacterId,
        kind: characterRelationships.kind,
        description: characterRelationships.description,
        sentiment: characterRelationships.sentiment,
        fromEpisodeNumber: characterRelationships.fromEpisodeNumber,
        toEpisodeNumber: characterRelationships.toEpisodeNumber,
      })
      .from(characterRelationships)
      .where(eq(characterRelationships.projectId, projectId)),
  ])

  const appearancesBy = new Map(appearances.map((a) => [a.characterId, Number(a.n)]))
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))

  const countsByTier: Record<string, number> = {}
  for (const row of counts) countsByTier[row.tier] = Number(row.n)

  return {
    characters: rows.map((row) => ({
      ...row,
      episodeCount: appearancesBy.get(row.id) ?? 0,
    })),
    relationships: relationshipRows.map((row) => ({
      ...row,
      fromName: nameOf.get(row.fromCharacterId) ?? '',
      toName: nameOf.get(row.toCharacterId) ?? '',
    })),
    countsByTier,
    total: Number(totals[0]?.n ?? 0),
  }
}

export async function getCharacter(
  projectId: string,
  characterId: string
): Promise<CharacterRow | null> {
  const [row] = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.projectId, projectId),
        isNull(characters.deletedAt)
      )
    )
    .limit(1)

  if (!row) return null

  const [appearance] = await db
    .select({ n: count() })
    .from(episodeCharacters)
    .where(eq(episodeCharacters.characterId, characterId))

  return { ...row, episodeCount: Number(appearance?.n ?? 0) }
}

export async function createCharacter(input: {
  projectId: string
  name: string
  alias?: string
  tier: CharacterTierValue
  user: SessionUser
}): Promise<CharacterRow> {
  const [created] = await db
    .insert(characters)
    .values({
      projectId: input.projectId,
      name: input.name.trim(),
      alias: input.alias?.trim() ?? '',
      tier: input.tier,
    })
    .onConflictDoNothing({ target: [characters.projectId, characters.name] })
    .returning()

  if (!created) {
    throw new ApiError(409, `「${input.name.trim()}」已經存在`, 'duplicate_name')
  }

  return { ...created, episodeCount: 0 }
}

/** Fields a member may edit. Ids, timestamps and the project are not among them. */
export type CharacterPatch = Partial<
  Pick<
    CharacterRow,
    | 'name'
    | 'alias'
    | 'tier'
    | 'age'
    | 'gender'
    | 'appearance'
    | 'personality'
    | 'background'
    | 'growth'
    | 'visualPrompt'
    | 'negativePrompt'
    | 'voiceProvider'
    | 'voiceId'
    | 'voiceStyle'
    | 'voiceNote'
    /*
     * These two were missing, so `keyVisualAssetId` was in the validator and
     * in the row and rendered by `Portrait` — but a PATCH carrying one was
     * silently dropped here. There was no way to give a character a portrait
     * at all.
     */
    | 'keyVisualAssetId'
    | 'voiceSampleAssetId'
  >
>

export async function updateCharacter(input: {
  projectId: string
  characterId: string
  patch: CharacterPatch
}): Promise<CharacterRow> {
  /*
   * The asset references are checked, not trusted.
   *
   * `key_visual_asset_id` and `voice_sample_asset_id` carry no foreign key —
   * like every other asset reference in this schema — so the database would
   * accept an id from another project, or one whose upload never finished. The
   * first reads across the project boundary; the second renders as a broken
   * image.
   */
  await assertAssetUsable(input.projectId, input.patch.keyVisualAssetId, 'IMAGE')
  await assertAssetUsable(input.projectId, input.patch.voiceSampleAssetId, 'AUDIO')

  const [updated] = await db
    .update(characters)
    .set({ ...input.patch, updatedAt: new Date() })
    .where(
      and(
        eq(characters.id, input.characterId),
        eq(characters.projectId, input.projectId),
        isNull(characters.deletedAt)
      )
    )
    .returning()

  if (!updated) throw ApiError.notFound('找不到這個角色')

  const [appearance] = await db
    .select({ n: count() })
    .from(episodeCharacters)
    .where(eq(episodeCharacters.characterId, input.characterId))

  return { ...updated, episodeCount: Number(appearance?.n ?? 0) }
}

/** Soft delete, so a cut character can come back without losing their notes. */
export async function removeCharacter(input: {
  projectId: string
  characterId: string
}): Promise<void> {
  const [removed] = await db
    .update(characters)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(characters.id, input.characterId),
        eq(characters.projectId, input.projectId),
        isNull(characters.deletedAt)
      )
    )
    .returning({ id: characters.id })

  if (!removed) throw ApiError.notFound('找不到這個角色')
}

export async function createRelationship(input: {
  projectId: string
  fromCharacterId: string
  toCharacterId: string
  kind: string
  description?: string
  sentiment?: number
}): Promise<RelationshipRow> {
  if (input.fromCharacterId === input.toCharacterId) {
    throw ApiError.badRequest('角色不能和自己建立關係')
  }

  // Both ends must belong to this project, or a relationship could be drawn
  // across two shows.
  const ends = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(
      and(
        eq(characters.projectId, input.projectId),
        isNull(characters.deletedAt),
        inArray(characters.id, [input.fromCharacterId, input.toCharacterId])
      )
    )

  if (ends.length !== 2) throw ApiError.notFound('找不到其中一位角色')

  const [created] = await db
    .insert(characterRelationships)
    .values({
      projectId: input.projectId,
      fromCharacterId: input.fromCharacterId,
      toCharacterId: input.toCharacterId,
      kind: input.kind.trim(),
      description: input.description?.trim() ?? '',
      sentiment: clampSentiment(input.sentiment ?? 0),
    })
    .returning()

  if (!created) throw new Error('Failed to create relationship')

  const nameOf = new Map(ends.map((e) => [e.id, e.name]))
  return {
    ...created,
    fromName: nameOf.get(created.fromCharacterId) ?? '',
    toName: nameOf.get(created.toCharacterId) ?? '',
  }
}

export async function removeRelationship(input: {
  projectId: string
  relationshipId: string
}): Promise<void> {
  const [removed] = await db
    .delete(characterRelationships)
    .where(
      and(
        eq(characterRelationships.id, input.relationshipId),
        eq(characterRelationships.projectId, input.projectId)
      )
    )
    .returning({ id: characterRelationships.id })

  if (!removed) throw ApiError.notFound('找不到這個關係')
}

/** -100 hostile .. 100 devoted. Out-of-range input is clamped, not rejected. */
function clampSentiment(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(Math.max(value, -100), 100))
}

/**
 * Refuses an asset that is not this project's, is not finished, or is the
 * wrong kind. A null or undefined id is fine — that is how the field is
 * cleared.
 */
async function assertAssetUsable(
  projectId: string,
  assetId: string | null | undefined,
  want: 'IMAGE' | 'AUDIO'
): Promise<void> {
  if (!assetId) return

  const [asset] = await db
    .select({ id: assets.id, kind: assets.kind, status: assets.uploadStatus })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
    .limit(1)

  if (!asset) {
    throw new ApiError(400, '找不到這個檔案，或它不屬於這部作品', 'asset_not_found')
  }
  if (asset.status !== 'COMPLETED') {
    throw new ApiError(409, '這個檔案還沒上傳完成', 'asset_incomplete')
  }

  const ok =
    want === 'IMAGE'
      ? asset.kind === 'IMAGE' || asset.kind === 'STICKER'
      : asset.kind === 'VOICE' || asset.kind === 'MUSIC' || asset.kind === 'SFX'

  if (!ok) {
    throw new ApiError(
      400,
      want === 'IMAGE' ? '定妝照必須是圖片' : '語音樣本必須是音訊檔',
      'asset_wrong_kind'
    )
  }
}
