import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assetLinks,
  assets,
  characterRelationships,
  characters,
  episodeCharacters,
  episodes,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { CHARACTER_PORTRAIT_SLOT, type CharacterTierValue } from '@/lib/constants'

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
  /** How many episodes this character is tagged into, from any source. */
  episodeCount: number
  /** Of those, how many have them written into the prose. */
  novelEpisodeCount: number
  /** …and into the script. The two differ, and the gap is the point. */
  scriptEpisodeCount: number
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

/**
 * 一張角色圖 (Z167).
 *
 * 一個角色可以有很多張；`characters.key_visual_asset_id` 指的是其中被選為
 * 定妝照的那一張。
 */
export type CharacterPortrait = {
  assetId: string
  /** 顯示用；素材的 `title`，沒設就用原始檔名。 */
  label: string
}

/** 列表用的角色，多帶一份圖庫。`updateCharacter` 回的是不帶圖的 `CharacterRow`。 */
export type CharacterListRow = CharacterRow & { portraits: CharacterPortrait[] }

export type CharacterOverview = {
  characters: CharacterListRow[]
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

  const [appearances, relationshipRows, portraitRows] = await Promise.all([
    ids.length
      ? db
          .select({
            characterId: episodeCharacters.characterId,
            n: count(),
            // 分開數，因為「寫進小說了」跟「進了劇本」不是同一件事，
            // 合成一個數字正好把值得看見的落差藏起來 (P0-1)。
            novel: sql<number>`count(*) filter (where ${episodeCharacters.fromNovel})`.mapWith(Number),
            script: sql<number>`count(*) filter (where ${episodeCharacters.fromScript})`.mapWith(Number),
          })
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

    /*
     * 角色圖 (Z167).
     *
     * 一次撈完這一頁所有角色的圖，不是每個角色一支查詢。`asset_links` 本來
     * 就有 `entity_type`/`entity_id`/`slot`，所以多圖不需要任何 schema 改
     * 動——缺的一直只是「列出來」這件事。
     *
     * 只算上傳完成且沒被軟刪的：一張還在上傳的圖放進圖庫會變成破圖，而刪掉
     * 的圖留在圖庫裡會讓人以為它還在。
     */
    ids.length
      ? db
          .select({
            characterId: assetLinks.entityId,
            assetId: assets.id,
            title: assets.title,
            name: assets.name,
          })
          .from(assetLinks)
          .innerJoin(assets, eq(assets.id, assetLinks.assetId))
          .where(
            and(
              eq(assetLinks.entityType, 'character'),
              inArray(assetLinks.entityId, ids),
              eq(assetLinks.slot, CHARACTER_PORTRAIT_SLOT),
              /*
               * 素材也要屬於這個專案 (Z168).
               *
               * 本來只靠 `entityId` 間接限定——也就是「相信 asset_links 的每
               * 一列都是乾淨的」。而建立那些列的 `beginUpload` 驗了
               * `episodeId` 屬於本專案，**沒有驗** `linkTo.entityId`：手動發
               * 一個 projectId 填 A、linkTo 指向 B 作品角色的上傳請求，那張
               * 圖就會出現在 B 的角色頁（而且因為檔案存取檢查會擋，看到的是
               * 破圖）。多這一條就不必相信它。
               */
              eq(assets.projectId, projectId),
              eq(assets.uploadStatus, 'COMPLETED'),
              isNull(assets.deletedAt)
            )
          )
          // 上傳順序。`sort_order` 全專案沒有人寫，拿它排序等於沒排。
          .orderBy(asc(assets.createdAt))
      : Promise.resolve([]),
  ])

  const portraitsBy = new Map<string, CharacterPortrait[]>()
  for (const row of portraitRows) {
    const list = portraitsBy.get(row.characterId) ?? []
    list.push({ assetId: row.assetId, label: row.title || row.name })
    portraitsBy.set(row.characterId, list)
  }

  const appearancesBy = new Map(appearances.map((a) => [a.characterId, a]))
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))

  const countsByTier: Record<string, number> = {}
  for (const row of counts) countsByTier[row.tier] = Number(row.n)

  return {
    characters: rows.map((row) => ({
      ...row,
      episodeCount: Number(appearancesBy.get(row.id)?.n ?? 0),
      novelEpisodeCount: appearancesBy.get(row.id)?.novel ?? 0,
      scriptEpisodeCount: appearancesBy.get(row.id)?.script ?? 0,
      portraits: portraitsBy.get(row.id) ?? [],
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
    .select({
      n: count(),
      novel: sql<number>`count(*) filter (where ${episodeCharacters.fromNovel})`.mapWith(Number),
      script: sql<number>`count(*) filter (where ${episodeCharacters.fromScript})`.mapWith(Number),
    })
    .from(episodeCharacters)
    .where(eq(episodeCharacters.characterId, characterId))

  return {
    ...row,
    episodeCount: Number(appearance?.n ?? 0),
    novelEpisodeCount: appearance?.novel ?? 0,
    scriptEpisodeCount: appearance?.script ?? 0,
  }
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

  // A character created this second is in nothing yet; the next sync decides.
  return { ...created, episodeCount: 0, novelEpisodeCount: 0, scriptEpisodeCount: 0 }
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

  /*
   * 被選為定妝照的那一張，一定要在圖庫裡 (Z167).
   *
   * 這是這個功能唯一需要維持的不變式。上傳走 `linkTo` 會自己建連結，但「把
   * 素材庫裡既有的一張圖設成定妝照」這條路不會——少了這一步，那張圖會是定
   * 妝照卻不出現在縮圖列，於是沒有任何辦法把它換掉。
   *
   * `isPrimary` 刻意不寫：哪一張是定妝照只有 `key_visual_asset_id` 說得上
   * 話。兩個欄位說同一件事，遲早會對不上。
   */
  if (input.patch.keyVisualAssetId) {
    await db
      .insert(assetLinks)
      .values({
        assetId: input.patch.keyVisualAssetId,
        entityType: 'character',
        entityId: input.characterId,
        slot: CHARACTER_PORTRAIT_SLOT,
      })
      .onConflictDoNothing()
  }

  const [appearance] = await db
    .select({
      n: count(),
      novel: sql<number>`count(*) filter (where ${episodeCharacters.fromNovel})`.mapWith(Number),
      script: sql<number>`count(*) filter (where ${episodeCharacters.fromScript})`.mapWith(Number),
    })
    .from(episodeCharacters)
    .where(eq(episodeCharacters.characterId, input.characterId))

  return {
    ...updated,
    episodeCount: Number(appearance?.n ?? 0),
    novelEpisodeCount: appearance?.novel ?? 0,
    scriptEpisodeCount: appearance?.script ?? 0,
  }
}

/**
 * 把一張圖從角色身上移掉 (Z167).
 *
 * 只解除連結，**不刪素材**：檔案留在素材庫。角色圖跟其他素材一樣可能被別的
 * 地方引用（分鏡的參考圖、對話附件），而「從這個角色移除」不該連帶把別人正
 * 在用的檔案刪掉。要真的刪檔案有素材中心那條路，它會先檢查引用。
 *
 * 移掉的剛好是定妝照的時候，把最早的那一張遞補上去，並回報遞補到哪一張，好
 * 讓介面說出來——使用者只知道自己刪了一張圖，不會自己想到角色列表上那張臉換
 * 人了。
 *
 * ## 定妝照目前只有畫面在讀
 *
 * 先更正一句寫錯的理由：`key_visual_asset_id` 現在**沒有**下游消費者。AI 拿
 * 角色的是 `name`/`tier`/`appearance`/`personality` 四個文字欄位
 * （`ai/jobs.ts`），`CHARACTER_DESIGN` 也只寫文字欄位；分鏡的參考圖是
 * `shots.ref_asset_id`，由使用者自己挑，沒有任何地方從定妝照帶過去。
 *
 * 唯一的讀取端是角色列表與角色面板的那張 `Portrait`。遞補這件事本身還是對
 * 的（那兩個地方真的會變），但它不是「AI 會失去樣貌參考」。等 Z154 接上圖片
 * 生成，這裡就是該把它接進去的地方。
 */
export async function unlinkCharacterPortrait(input: {
  projectId: string
  characterId: string
  assetId: string
}): Promise<{ promotedTo: string | null; wasPrimary: boolean }> {
  const [character] = await db
    .select({ id: characters.id, keyVisualAssetId: characters.keyVisualAssetId })
    .from(characters)
    .where(
      and(
        eq(characters.id, input.characterId),
        eq(characters.projectId, input.projectId),
        isNull(characters.deletedAt)
      )
    )
    .limit(1)

  if (!character) throw ApiError.notFound('找不到這個角色')

  const removed = await db
    .delete(assetLinks)
    .where(
      and(
        eq(assetLinks.assetId, input.assetId),
        eq(assetLinks.entityType, 'character'),
        eq(assetLinks.entityId, input.characterId),
        eq(assetLinks.slot, CHARACTER_PORTRAIT_SLOT)
      )
    )
    .returning({ id: assetLinks.id })

  if (removed.length === 0) throw ApiError.notFound('這張圖不在這個角色的圖庫裡')

  const wasPrimary = character.keyVisualAssetId === input.assetId
  if (!wasPrimary) return { promotedTo: null, wasPrimary: false }

  const [next] = await db
    .select({ assetId: assets.id })
    .from(assetLinks)
    .innerJoin(assets, eq(assets.id, assetLinks.assetId))
    .where(
      and(
        eq(assetLinks.entityType, 'character'),
        eq(assetLinks.entityId, input.characterId),
        eq(assetLinks.slot, CHARACTER_PORTRAIT_SLOT),
        eq(assets.uploadStatus, 'COMPLETED'),
        isNull(assets.deletedAt)
      )
    )
    .orderBy(asc(assets.createdAt))
    .limit(1)

  await db
    .update(characters)
    .set({ keyVisualAssetId: next?.assetId ?? null, updatedAt: new Date() })
    .where(eq(characters.id, input.characterId))

  return { promotedTo: next?.assetId ?? null, wasPrimary: true }
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
    .select({
      id: assets.id,
      kind: assets.kind,
      status: assets.uploadStatus,
      deletedAt: assets.deletedAt,
    })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
    .limit(1)

  if (!asset) {
    throw new ApiError(400, '找不到這個檔案，或它不屬於這部作品', 'asset_not_found')
  }
  if (asset.status !== 'COMPLETED') {
    throw new ApiError(409, '這個檔案還沒上傳完成', 'asset_incomplete')
  }
  /*
   * 軟刪掉的檔案也要擋 (Z168).
   *
   * 不擋的話「定妝照一定在圖庫裡」這個不變式有一條繞道：圖庫查詢濾掉軟刪的
   * 素材，而這裡不濾——於是 `key_visual_asset_id` 可以指著一張已經刪掉的
   * 圖，畫面上是大預覽破圖、而縮圖列裡沒有任何一張帶「定妝」徽章。
   *
   * 對話附件被「收回」時就會軟刪（`chat.ts` 的 `origin='CHAT'`），所以這不
   * 是假想情況。
   */
  if (asset.deletedAt) {
    throw new ApiError(409, '這個檔案已經被刪掉了', 'asset_deleted')
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
