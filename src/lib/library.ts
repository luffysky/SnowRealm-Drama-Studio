import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assetLicenses,
  assets,
  audioMetadata,
  chapters,
  documents,
  episodes,
  projects,
} from '@/db/schema'
import type { ProjectStatusValue } from '@/lib/constants'
import { visibleProjects } from '@/lib/project-access'

/**
 * 閱覽室 — reading and playing what the studio has finished, across every work.
 *
 * Cross-project by design, which is why it lives in the global rail rather
 * than inside a project workspace (`docs/ROUTES.md` §1). The project workspace
 * is where things are made; this is where they are consumed, the way a reader
 * would: pick a book, pick an episode, pick a track.
 *
 * Nothing here invents an entry. A work with no prose does not appear on the
 * shelf, an episode with no finished cut does not appear in the drama list,
 * and a track whose upload never completed does not appear in the player —
 * each of those would be a promise the library cannot keep.
 */

/* -------------------------------------------------------------------------- */
/* 小說書架                                                                     */
/* -------------------------------------------------------------------------- */

export type ShelfNovel = {
  projectId: string
  title: string
  novelTitle: string
  synopsis: string
  coverAssetId: string | null
  novelCoverAssetId: string | null
  status: ProjectStatusValue
  tags: string[]
  chapterCount: number
  episodeCount: number
  charCount: number
  updatedAt: Date | null
}

export async function listNovels(userId: string): Promise<ShelfNovel[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      title: projects.title,
      novelTitle: projects.novelTitle,
      synopsis: projects.synopsis,
      coverAssetId: projects.coverAssetId,
      novelCoverAssetId: projects.novelCoverAssetId,
      status: projects.status,
      tags: projects.tags,
      chapterCount: sql<number>`count(${chapters.id})`.mapWith(Number),
      episodeCount: sql<number>`count(distinct ${episodes.id})`.mapWith(Number),
      charCount: sql<number>`coalesce(sum(${chapters.charCount}), 0)`.mapWith(Number),
      updatedAt: sql<Date | null>`max(${chapters.updatedAt})`,
    })
    .from(projects)
    .leftJoin(
      episodes,
      and(eq(episodes.projectId, projects.id), isNull(episodes.deletedAt))
    )
    .leftJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .leftJoin(chapters, eq(chapters.documentId, documents.id))
    .where(and(visibleProjects(userId), isNull(projects.deletedAt)))
    .groupBy(projects.id)
    .orderBy(desc(projects.isFlagship), desc(projects.updatedAt))

  // A work with no prose is not a book yet. Listing it would put a cover on
  // the shelf that opens onto nothing.
  return rows.filter((row) => row.charCount > 0)
}

/* -------------------------------------------------------------------------- */
/* 短劇                                                                        */
/* -------------------------------------------------------------------------- */

export type DramaWork = {
  projectId: string
  title: string
  dramaTitle: string
  synopsis: string
  coverAssetId: string | null
  status: ProjectStatusValue
  tags: string[]
  releasedCount: number
  totalEpisodes: number
  totalSeconds: number
}

export type DramaEpisode = {
  episodeId: string
  number: number
  title: string
  logline: string
  assetId: string
  durationSec: number | null
  sizeBytes: number
  hasPoster: boolean
  updatedAt: Date
}

export async function listDramas(userId: string): Promise<DramaWork[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      title: projects.title,
      dramaTitle: projects.dramaTitle,
      synopsis: projects.synopsis,
      coverAssetId: projects.coverAssetId,
      status: projects.status,
      tags: projects.tags,
      totalEpisodes: sql<number>`count(${episodes.id})`.mapWith(Number),
      releasedCount: sql<number>`count(${episodes.finalAssetId})`.mapWith(Number),
      totalSeconds: sql<number>`coalesce(sum(${assets.durationSec}), 0)`.mapWith(Number),
    })
    .from(projects)
    .leftJoin(episodes, and(eq(episodes.projectId, projects.id), isNull(episodes.deletedAt)))
    .leftJoin(assets, eq(assets.id, episodes.finalAssetId))
    .where(and(visibleProjects(userId), isNull(projects.deletedAt)))
    .groupBy(projects.id)
    .orderBy(desc(projects.isFlagship), desc(projects.updatedAt))

  return rows.filter((row) => row.releasedCount > 0)
}

/** Episodes of one work that have a finished cut, in order. */
export async function listDramaEpisodes(projectId: string): Promise<DramaEpisode[]> {
  const rows = await db
    .select({
      episodeId: episodes.id,
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      assetId: assets.id,
      durationSec: assets.durationSec,
      sizeBytes: assets.sizeBytes,
      updatedAt: assets.updatedAt,
      hasPoster: sql<boolean>`exists (
        select 1 from asset_variants v
         where v.asset_id = ${assets.id} and v.kind = 'PREVIEW'
           and v.upload_status = 'COMPLETED'
      )`,
    })
    .from(episodes)
    .innerJoin(
      assets,
      and(eq(assets.id, episodes.finalAssetId), eq(assets.uploadStatus, 'COMPLETED'))
    )
    .where(
      and(
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt),
        isNull(assets.deletedAt)
      )
    )
    .orderBy(asc(episodes.number))

  return rows.map((row) => ({ ...row, hasPoster: Boolean(row.hasPoster) }))
}

/* -------------------------------------------------------------------------- */
/* 音樂                                                                        */
/* -------------------------------------------------------------------------- */

export type LibraryTrack = {
  assetId: string
  projectId: string
  projectTitle: string
  title: string
  name: string
  artist: string
  category: string
  genreTags: string[]
  moodTags: string[]
  durationSec: number | null
  sizeBytes: number
  licenseStatus: string
  hasWaveform: boolean
  updatedAt: Date
}

/** Every playable track in the studio, newest first. */
export async function listTracks(userId: string): Promise<LibraryTrack[]> {
  const rows = await db
    .select({
      assetId: assets.id,
      projectId: projects.id,
      projectTitle: projects.title,
      title: assets.title,
      name: assets.name,
      durationSec: assets.durationSec,
      sizeBytes: assets.sizeBytes,
      updatedAt: assets.updatedAt,
      artist: audioMetadata.artist,
      category: audioMetadata.category,
      genreTags: audioMetadata.genreTags,
      moodTags: audioMetadata.moodTags,
      licenseStatus: assetLicenses.status,
      hasWaveform: sql<boolean>`exists (
        select 1 from asset_variants v
         where v.asset_id = ${assets.id} and v.kind = 'WAVEFORM'
           and v.upload_status = 'COMPLETED'
      )`,
    })
    .from(assets)
    .innerJoin(projects, eq(projects.id, assets.projectId))
    .leftJoin(audioMetadata, eq(audioMetadata.assetId, assets.id))
    .leftJoin(
      assetLicenses,
      and(eq(assetLicenses.assetId, assets.id), isNull(assetLicenses.deletedAt))
    )
    .where(
      and(
        visibleProjects(userId),
        eq(assets.kind, 'MUSIC'),
        // Only finished uploads: a PENDING row has no audio behind it, and a
        // player that cannot play is worse than an empty list.
        eq(assets.uploadStatus, 'COMPLETED'),
        isNull(assets.deletedAt),
        isNull(projects.deletedAt)
      )
    )
    .orderBy(desc(assets.updatedAt))

  return rows.map((row) => ({
    ...row,
    artist: row.artist ?? '',
    category: row.category ?? 'OTHER',
    genreTags: row.genreTags ?? [],
    moodTags: row.moodTags ?? [],
    licenseStatus: row.licenseStatus ?? 'PENDING_REVIEW',
    hasWaveform: Boolean(row.hasWaveform),
  }))
}
