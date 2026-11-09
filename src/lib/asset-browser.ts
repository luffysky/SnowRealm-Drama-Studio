import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { assets, assetVariants, episodes, users } from '@/db/schema'
import type { AssetKindValue } from '@/lib/constants'
import type { AssetSort } from '@/lib/asset-browser-view'

/**
 * Listing for the per-kind asset tabs (designs 81, 86, 87, 89).
 *
 * One query serves 全部素材, 圖片, 影片, 音效, 配音 and 文件, because the tabs
 * differ only in which kinds they admit. 音樂 keeps its own module: it joins
 * `audio_metadata` and `asset_licenses` for filters the other tabs do not have,
 * and folding that in would make every other tab pay for three joins it never
 * reads.
 *
 * Paging and search run in SQL and are driven from the URL, so a reload or a
 * shared link lands on the same view.
 */

export const DEFAULT_PER_PAGE = 24

export type AssetBrowserQuery = {
  q?: string
  episodeId?: string
  sort?: AssetSort
  page?: number
  perPage?: number
}

export type AssetBrowserRow = {
  id: string
  kind: AssetKindValue
  title: string
  name: string
  mimeType: string
  sizeBytes: number
  durationSec: number | null
  width: number | null
  height: number | null
  version: number
  uploadedByName: string | null
  episodeNumber: number | null
  hasPreview: boolean
  hasWaveform: boolean
  createdAt: Date
  updatedAt: Date
}

export type AssetBrowserResult = {
  rows: AssetBrowserRow[]
  matched: number
  page: number
  pageCount: number
  perPage: number
  /** Totals per kind across the whole tab, ignoring search and paging. */
  kindCounts: Record<string, number>
  totalBytes: number
  /** Episodes that actually hold one of these kinds, for the filter. */
  episodeOptions: { id: string; number: number; title: string }[]
}

export async function listAssets(
  projectId: string,
  kinds: AssetKindValue[],
  query: AssetBrowserQuery = {}
): Promise<AssetBrowserResult> {
  const perPage = Math.min(Math.max(query.perPage ?? DEFAULT_PER_PAGE, 6), 96)

  const base: SQL[] = [
    eq(assets.projectId, projectId),
    // Only finished uploads: a PENDING row has no bytes behind it, and showing
    // one would put an unplayable, undownloadable tile in the grid.
    eq(assets.uploadStatus, 'COMPLETED'),
    /*
     * 素材庫的，不含對話的附件 (Z116).
     *
     * A chat voice message is a `kind = 'VOICE'` asset like any other, so
     * without this it sat in 配音 next to the material actually meant for
     * dubbing. 「語音訊息-1793747242682.webm」 is not a take of anybody's
     * lines.
     */
    eq(assets.origin, 'LIBRARY'),
  ]

  const notDeleted = isNull(assets.deletedAt)
  if (notDeleted) base.push(notDeleted)

  // An empty list means 全部素材 — every kind, no predicate.
  if (kinds.length > 0) {
    const kindFilter = inArray(assets.kind, kinds)
    if (kindFilter) base.push(kindFilter)
  }

  const filters = [...base]

  const q = query.q?.trim()
  if (q) {
    const like = `%${q}%`
    const match = or(ilike(assets.title, like), ilike(assets.name, like))
    if (match) filters.push(match)
  }

  if (query.episodeId) {
    filters.push(eq(assets.episodeId, query.episodeId))
  }

  const order = (() => {
    switch (query.sort ?? 'recent') {
      case 'name':
        return [asc(sql`coalesce(nullif(${assets.title}, ''), ${assets.name})`)]
      case 'size':
        return [desc(assets.sizeBytes)]
      case 'kind':
        return [asc(assets.kind), desc(assets.createdAt)]
      case 'oldest':
        return [asc(assets.createdAt)]
      default:
        return [desc(assets.createdAt)]
    }
  })()

  const [[countRow], kindRows, episodeRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        bytes: sql<number>`coalesce(sum(${assets.sizeBytes}), 0)`.mapWith(Number),
      })
      .from(assets)
      .where(and(...filters)),

    // Counts ignore the search box, so the chips do not jump about while
    // someone types.
    db
      .select({ kind: assets.kind, total: sql<number>`count(*)`.mapWith(Number) })
      .from(assets)
      .where(and(...base))
      .groupBy(assets.kind),

    db
      .selectDistinct({
        id: episodes.id,
        number: episodes.number,
        title: episodes.title,
      })
      .from(assets)
      .innerJoin(episodes, eq(episodes.id, assets.episodeId))
      .where(and(...base))
      .orderBy(asc(episodes.number)),
  ])

  const matched = countRow?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(matched / perPage))
  // Clamp rather than return nothing: narrowing a filter while on page 9 would
  // otherwise strand the reader on an empty page.
  const page = Math.min(Math.max(query.page ?? 1, 1), pageCount)

  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      title: assets.title,
      name: assets.name,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      durationSec: assets.durationSec,
      width: assets.width,
      height: assets.height,
      version: assets.version,
      uploadedByName: users.name,
      episodeNumber: episodes.number,
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
      /*
       * 外層那一欄要**寫死限定名**，不要用 ${} 內插 (Z199).
       *
       * drizzle 把內插進 sql 模板的欄位物件渲染成**不帶表名**的 "id"，而在子
       * 查詢裡那個名字會綁到最內層那張表——它也有 id 欄。於是條件變成
       * `x.foo_id = x.id`，永遠不成立，而 Postgres 不會報錯，它只是乖乖回
       * 0／false。
       */
      hasPreview: sql<boolean>`exists (
        select 1 from ${assetVariants} v
         where v.asset_id = assets.id and v.kind = 'PREVIEW'
           and v.upload_status = 'COMPLETED'
      )`,
      hasWaveform: sql<boolean>`exists (
        select 1 from ${assetVariants} v
         where v.asset_id = assets.id and v.kind = 'WAVEFORM'
           and v.upload_status = 'COMPLETED'
      )`,
    })
    .from(assets)
    .leftJoin(users, eq(users.id, assets.uploadedById))
    .leftJoin(episodes, eq(episodes.id, assets.episodeId))
    .where(and(...filters))
    .orderBy(...order)
    .limit(perPage)
    .offset((page - 1) * perPage)

  return {
    rows: rows.map((row) => ({
      ...row,
      kind: row.kind as AssetKindValue,
      uploadedByName: row.uploadedByName ?? null,
      episodeNumber: row.episodeNumber ?? null,
      hasPreview: Boolean(row.hasPreview),
      hasWaveform: Boolean(row.hasWaveform),
    })),
    matched,
    page,
    pageCount,
    perPage,
    kindCounts: Object.fromEntries(kindRows.map((row) => [row.kind, row.total])),
    totalBytes: countRow?.bytes ?? 0,
    episodeOptions: episodeRows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title ?? '',
    })),
  }
}
