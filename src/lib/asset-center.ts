import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { assetLicenses, assets, episodes, users } from '@/db/schema'
import { ASSET_KINDS, type AssetKindValue } from '@/lib/constants'

/**
 * 素材資產中心總覽 (design 81, Z4).
 *
 * Every figure here is counted from the database. The reference art shows a
 * storage bar reading 「256.8 GB / 1 TB」, and that denominator is not
 * reproduced: R2 has no per-bucket quota, so a progress bar against 1 TB would
 * be a decoration implying a limit that does not exist. What the pair actually
 * need to watch is the monthly cost, which is linear in what is stored
 * (`docs/STORAGE.md`), so that is what this reports instead.
 */

/** R2 Standard, USD per GB-month. The first 10 GB each month are free. */
const STORAGE_USD_PER_GB_MONTH = 0.015
const FREE_TIER_GB = 10

export type KindSummary = {
  kind: AssetKindValue
  count: number
  sizeBytes: number
}

export type RecentAsset = {
  id: string
  kind: AssetKindValue
  title: string
  name: string
  sizeBytes: number
  durationSec: number | null
  episodeNumber: number | null
  uploadedByName: string | null
  createdAt: Date
  hasPreview: boolean
}

export type EpisodeUsage = {
  episodeId: string
  number: number
  title: string
  count: number
  coverAssetId: string | null
}

export type AssetCenterData = {
  total: number
  sizeBytes: number
  /** Estimated monthly storage cost in USD, after the free tier. */
  estimatedMonthlyUsd: number
  byKind: KindSummary[]
  recent: RecentAsset[]
  episodes: EpisodeUsage[]
  licenses: { pending: number; approved: number; expiringSoon: number; total: number }
}

export async function getAssetCenter(projectId: string): Promise<AssetCenterData> {
  const [kindRows, recentRows, episodeRows, licenseRow] = await Promise.all([
    db
      .select({
        kind: assets.kind,
        count: sql<number>`count(*)`.mapWith(Number),
        sizeBytes: sql<number>`coalesce(sum(${assets.sizeBytes}), 0)`.mapWith(Number),
      })
      .from(assets)
      .where(
        and(
          eq(assets.projectId, projectId),
          // Only finished uploads: a PENDING row has no bytes behind it yet,
          // so counting it would overstate both the library and the bill.
          eq(assets.uploadStatus, 'COMPLETED'),
          isNull(assets.deletedAt)
        )
      )
      .groupBy(assets.kind),

    db
      .select({
        id: assets.id,
        kind: assets.kind,
        title: assets.title,
        name: assets.name,
        sizeBytes: assets.sizeBytes,
        durationSec: assets.durationSec,
        episodeNumber: episodes.number,
        uploadedByName: users.name,
        createdAt: assets.createdAt,
        hasPreview: sql<boolean>`exists (
          select 1 from asset_variants v
           where v.asset_id = assets.id and v.kind = 'PREVIEW'
             and v.upload_status = 'COMPLETED'
        )`,
      })
      .from(assets)
      .leftJoin(episodes, eq(episodes.id, assets.episodeId))
      .leftJoin(users, eq(users.id, assets.uploadedById))
      .where(
        and(
          eq(assets.projectId, projectId),
          eq(assets.uploadStatus, 'COMPLETED'),
          isNull(assets.deletedAt)
        )
      )
      .orderBy(desc(assets.createdAt))
      .limit(8),

    db
      .select({
        episodeId: episodes.id,
        number: episodes.number,
        title: episodes.title,
        coverAssetId: episodes.coverAssetId,
        count: sql<number>`count(${assets.id})`.mapWith(Number),
      })
      .from(episodes)
      .innerJoin(
        assets,
        and(
          eq(assets.episodeId, episodes.id),
          eq(assets.uploadStatus, 'COMPLETED'),
          isNull(assets.deletedAt)
        )
      )
      .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
      .groupBy(episodes.id, episodes.number, episodes.title, episodes.coverAssetId)
      .orderBy(desc(sql`count(${assets.id})`))
      .limit(6),

    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${assetLicenses.status} = 'PENDING_REVIEW')`.mapWith(
          Number
        ),
        approved: sql<number>`count(*) filter (where ${assetLicenses.status} = 'APPROVED')`.mapWith(
          Number
        ),
        /*
         * Licences inside 90 days of expiry. Design 88 asks for this at the
         * top level because an expiry that surfaces late is one that has
         * already shipped in an episode.
         */
        expiringSoon: sql<number>`count(*) filter (
          where ${assetLicenses.validUntil} is not null
            and ${assetLicenses.validUntil} <= now() + interval '90 days'
            and ${assetLicenses.validUntil} > now()
        )`.mapWith(Number),
      })
      .from(assetLicenses)
      .innerJoin(assets, eq(assets.id, assetLicenses.assetId))
      .where(and(eq(assets.projectId, projectId), isNull(assetLicenses.deletedAt))),
  ])

  const counts = new Map(kindRows.map((row) => [row.kind, row]))

  /*
   * Every kind is listed, including the empty ones, in a fixed order. The
   * acceptance test is explicit that an empty library shows 0 rather than
   * hiding the category — a missing row reads as "not supported", which is a
   * different claim.
   */
  const byKind: KindSummary[] = ASSET_KINDS.map((kind) => ({
    kind,
    count: counts.get(kind)?.count ?? 0,
    sizeBytes: counts.get(kind)?.sizeBytes ?? 0,
  }))

  const sizeBytes = byKind.reduce((sum, row) => sum + row.sizeBytes, 0)
  const gigabytes = sizeBytes / 1024 ** 3
  const billable = Math.max(0, gigabytes - FREE_TIER_GB)

  return {
    total: byKind.reduce((sum, row) => sum + row.count, 0),
    sizeBytes,
    estimatedMonthlyUsd: billable * STORAGE_USD_PER_GB_MONTH,
    byKind,
    recent: recentRows.map((row) => ({ ...row, hasPreview: Boolean(row.hasPreview) })),
    episodes: episodeRows,
    licenses: licenseRow[0] ?? { pending: 0, approved: 0, expiringSoon: 0, total: 0 },
  }
}
