import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { assetLicenses, assets, audioMetadata } from '@/db/schema'
import type { AssetKindValue } from '@/lib/constants'
import type { MusicSort } from '@/lib/music-view'

/**
 * 音樂素材庫 (design 82, Z5).
 *
 * Paging, searching and filtering happen in SQL, and every one of them is
 * driven from the URL. The acceptance test is 「搜尋/分頁重整仍有效」, which
 * only holds if the state lives somewhere a refresh can read — component
 * state would survive neither a reload nor a shared link.
 */

export { MUSIC_SORTS, MUSIC_SORT_LABEL } from '@/lib/music-view'
export type { MusicSort } from '@/lib/music-view'

export const DEFAULT_PER_PAGE = 10

export type MusicQuery = {
  q?: string
  category?: string
  mood?: string
  genre?: string
  license?: string
  sort?: MusicSort
  page?: number
  perPage?: number
}

export type MusicRow = {
  assetId: string
  title: string
  name: string
  category: string
  genreTags: string[]
  moodTags: string[]
  artist: string
  language: string
  durationSec: number | null
  sizeBytes: number
  version: number
  sourcePlatform: string
  licenseStatus: string
  hasWaveform: boolean
  updatedAt: Date
}

export type MusicListResult = {
  rows: MusicRow[]
  matched: number
  page: number
  pageCount: number
  perPage: number
  /** Counts per category across the whole project, for the filter chips. */
  categoryCounts: Record<string, number>
  /** Every tag in use, so the filters offer what exists rather than a guess. */
  availableGenres: string[]
  availableMoods: string[]
}

/** Audio kinds the music library covers. 音效 and 配音 have their own pages. */
const MUSIC_KIND: AssetKindValue = 'MUSIC'

export async function listMusic(
  projectId: string,
  query: MusicQuery = {}
): Promise<MusicListResult> {
  const perPage = Math.min(Math.max(query.perPage ?? DEFAULT_PER_PAGE, 5), 50)

  const base: SQL[] = [
    eq(assets.projectId, projectId),
    eq(assets.kind, MUSIC_KIND),
    // Only finished uploads. A PENDING row has no audio behind it, and the
    // acceptance test is explicit: 無音檔不顯示假曲目.
    eq(assets.uploadStatus, 'COMPLETED'),
  ]
  const notDeleted = isNull(assets.deletedAt)
  if (notDeleted) base.push(notDeleted)

  const filters = [...base]

  const q = query.q?.trim()
  if (q) {
    const like = `%${q}%`
    const match = or(
      ilike(assets.title, like),
      ilike(assets.name, like),
      ilike(audioMetadata.artist, like),
      ilike(audioMetadata.description, like)
    )
    if (match) filters.push(match)
  }

  if (query.category) {
    filters.push(sql`${audioMetadata.category}::text = ${query.category}`)
  }
  if (query.license) {
    filters.push(sql`${assetLicenses.status}::text = ${query.license}`)
  }
  /*
   * Tag filters use array containment rather than a join: the tags are a
   * `text[]` on one row, and `@>` lets Postgres answer without expanding them.
   */
  if (query.genre) {
    filters.push(sql`${audioMetadata.genreTags} @> ARRAY[${query.genre}]::text[]`)
  }
  if (query.mood) {
    filters.push(sql`${audioMetadata.moodTags} @> ARRAY[${query.mood}]::text[]`)
  }

  const order = (() => {
    switch (query.sort ?? 'recent') {
      case 'title':
        return [asc(sql`coalesce(nullif(${assets.title}, ''), ${assets.name})`)]
      case 'duration':
        return [desc(sql`coalesce(${assets.durationSec}, 0)`)]
      case 'category':
        return [asc(audioMetadata.category), asc(assets.title)]
      default:
        return [desc(assets.updatedAt)]
    }
  })()

  const [[countRow], categoryRows, tagRows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(assets)
      .leftJoin(audioMetadata, eq(audioMetadata.assetId, assets.id))
      .leftJoin(
        assetLicenses,
        and(eq(assetLicenses.assetId, assets.id), isNull(assetLicenses.deletedAt))
      )
      .where(and(...filters)),

    // Chip counts ignore the filters, so switching category never makes the
    // other numbers jump around.
    db
      .select({
        category: audioMetadata.category,
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(assets)
      .innerJoin(audioMetadata, eq(audioMetadata.assetId, assets.id))
      .where(and(...base))
      .groupBy(audioMetadata.category),

    db
      .select({
        genres: sql<string[]>`coalesce(array_agg(distinct g), '{}')`,
        moods: sql<string[]>`coalesce(array_agg(distinct m), '{}')`,
      })
      .from(
        sql`(
          select unnest(am.genre_tags) as g, null::text as m
            from audio_metadata am
            join assets a on a.id = am.asset_id
           where a.project_id = ${projectId} and a.deleted_at is null
          union all
          select null::text as g, unnest(am.mood_tags) as m
            from audio_metadata am
            join assets a on a.id = am.asset_id
           where a.project_id = ${projectId} and a.deleted_at is null
        ) tags`
      ),
  ])

  const matched = countRow?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(matched / perPage))
  // Clamp rather than return nothing: narrowing a filter while on page 9
  // would otherwise strand the reader on an empty page.
  const page = Math.min(Math.max(query.page ?? 1, 1), pageCount)

  const rows = await db
    .select({
      assetId: assets.id,
      title: assets.title,
      name: assets.name,
      durationSec: assets.durationSec,
      sizeBytes: assets.sizeBytes,
      version: assets.version,
      updatedAt: assets.updatedAt,
      category: audioMetadata.category,
      genreTags: audioMetadata.genreTags,
      moodTags: audioMetadata.moodTags,
      artist: audioMetadata.artist,
      language: audioMetadata.language,
      sourcePlatform: audioMetadata.sourcePlatform,
      licenseStatus: assetLicenses.status,
      hasWaveform: sql<boolean>`exists (
        select 1 from asset_variants v
         where v.asset_id = assets.id and v.kind = 'WAVEFORM'
           and v.upload_status = 'COMPLETED'
      )`,
    })
    .from(assets)
    .leftJoin(audioMetadata, eq(audioMetadata.assetId, assets.id))
    .leftJoin(
      assetLicenses,
      and(eq(assetLicenses.assetId, assets.id), isNull(assetLicenses.deletedAt))
    )
    .where(and(...filters))
    .orderBy(...order)
    .limit(perPage)
    .offset((page - 1) * perPage)

  return {
    rows: rows.map((row) => ({
      assetId: row.assetId,
      title: row.title,
      name: row.name,
      category: row.category ?? 'OTHER',
      genreTags: row.genreTags ?? [],
      moodTags: row.moodTags ?? [],
      artist: row.artist ?? '',
      language: row.language ?? '',
      durationSec: row.durationSec,
      sizeBytes: row.sizeBytes,
      version: row.version,
      sourcePlatform: row.sourcePlatform ?? '',
      licenseStatus: row.licenseStatus ?? 'PENDING_REVIEW',
      hasWaveform: Boolean(row.hasWaveform),
      updatedAt: row.updatedAt,
    })),
    matched,
    page,
    pageCount,
    perPage,
    categoryCounts: Object.fromEntries(categoryRows.map((row) => [row.category, row.total])),
    availableGenres: (tagRows[0]?.genres ?? []).filter(Boolean).sort(),
    availableMoods: (tagRows[0]?.moods ?? []).filter(Boolean).sort(),
  }
}
