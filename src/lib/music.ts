import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  assetLicenses,
  assetVariants,
  assets,
  audioMetadata,
  audioRevisions,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'

/**
 * 音樂素材 (designs 82 / 84 / 85, Z6).
 *
 * A track is three rows plus a file:
 *
 *   assets            the file itself — already uploaded before we get here
 *   audio_metadata    what it is: category, mood, artist, source
 *   audio_revisions   the (revision × variant) grid; the original is one cell
 *   asset_licenses    whether it may actually be used
 *
 * They are written in one transaction. A track with a file and no licence row
 * would be a track the licence screen cannot see, and 88 is built on the
 * premise that *every* audio asset has a licence record even when its status
 * is 「待確認」 — that status is the whole point.
 */

export type MusicCategory =
  | 'OP'
  | 'ED'
  | 'BGM'
  | 'INSERT'
  | 'CHARACTER_SONG'
  | 'OTHER'

export type MusicInput = {
  title: string
  category: MusicCategory
  genreTags: string[]
  moodTags: string[]
  language: string
  artist: string
  bpm: number | null
  musicalKey: string
  sourcePlatform: string
  description: string
  /** Read from the file in the browser; the upload pipeline does not decode. */
  durationSec?: number | null
}

export type MusicTrack = MusicInput & {
  assetId: string
  name: string
  mimeType: string
  sizeBytes: number
  version: number
  hasWaveform: boolean
  licenseStatus: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Turns an uploaded file into a track.
 *
 * The asset must already exist and be COMPLETED — this is the step *after*
 * the bytes are in R2, never a replacement for it. Registering metadata
 * against a half-finished upload would put a track in the library that cannot
 * be played, which is exactly what spec §2-84's「檔案未完成不可顯示可使用」
 * forbids.
 */
export async function createMusic(input: {
  user: SessionUser
  projectId: string
  assetId: string
  data: MusicInput
}): Promise<{ assetId: string }> {
  const [asset] = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      status: assets.uploadStatus,
    })
    .from(assets)
    .where(and(eq(assets.id, input.assetId), eq(assets.projectId, input.projectId)))
    .limit(1)

  if (!asset) {
    throw new ApiError(404, '找不到這個檔案，或它不屬於這部作品', 'asset_not_found')
  }
  if (asset.status !== 'COMPLETED') {
    throw new ApiError(409, '這個檔案還沒上傳完成', 'asset_incomplete')
  }
  if (asset.kind !== 'MUSIC' && asset.kind !== 'SFX' && asset.kind !== 'VOICE') {
    throw new ApiError(400, '這個檔案不是音訊素材', 'asset_not_audio')
  }

  await db.transaction(async (tx) => {
    await tx
      .update(assets)
      .set({
        title: input.data.title,
        ...(input.data.durationSec != null
          ? { durationSec: Math.round(input.data.durationSec) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(assets.id, input.assetId))

    await tx
      .insert(audioMetadata)
      .values({
        assetId: input.assetId,
        category: input.data.category,
        genreTags: input.data.genreTags,
        moodTags: input.data.moodTags,
        language: input.data.language,
        artist: input.data.artist,
        bpm: input.data.bpm,
        musicalKey: input.data.musicalKey,
        sourcePlatform: input.data.sourcePlatform,
        description: input.data.description,
      })
      .onConflictDoUpdate({
        target: audioMetadata.assetId,
        set: {
          category: input.data.category,
          genreTags: input.data.genreTags,
          moodTags: input.data.moodTags,
          language: input.data.language,
          artist: input.data.artist,
          bpm: input.data.bpm,
          musicalKey: input.data.musicalKey,
          sourcePlatform: input.data.sourcePlatform,
          description: input.data.description,
          updatedAt: new Date(),
        },
      })

    /*
     * The anchor cell. `fileAssetId` equals `assetId` for the original upload;
     * later remasters and instrumentals add cells pointing at their own files.
     * Writing it even for a single file means no code has to special-case
     * "the one without a row".
     */
    await tx
      .insert(audioRevisions)
      .values({
        assetId: input.assetId,
        fileAssetId: input.assetId,
        revision: 1,
        variant: 'FULL',
        reviewStatus: 'DRAFT',
        isDefault: true,
        createdById: input.user.id,
      })
      .onConflictDoNothing()

    /*
     * A licence row from the start, status 待確認.
     *
     * Uploading is not licensing. 88 reports on licences, and a track with no
     * row would simply be missing from that report rather than appearing as
     * unresolved — which is the failure mode that lets unlicensed music ship.
     */
    const existing = await tx
      .select({ id: assetLicenses.id })
      .from(assetLicenses)
      .where(and(eq(assetLicenses.assetId, input.assetId), isNull(assetLicenses.deletedAt)))
      .limit(1)

    if (existing.length === 0) {
      await tx.insert(assetLicenses).values({
        assetId: input.assetId,
        status: 'PENDING_REVIEW',
        source: input.data.sourcePlatform,
        createdById: input.user.id,
      })
    }
  })

  return { assetId: input.assetId }
}

/** Edits an existing track's metadata. The file is never touched here. */
export async function updateMusic(input: {
  projectId: string
  assetId: string
  data: MusicInput
}): Promise<{ assetId: string } | null> {
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, input.assetId),
        eq(assets.projectId, input.projectId),
        isNull(assets.deletedAt)
      )
    )
    .limit(1)

  if (!asset) return null

  await db.transaction(async (tx) => {
    await tx
      .update(assets)
      .set({ title: input.data.title, updatedAt: new Date() })
      .where(eq(assets.id, input.assetId))

    await tx
      .insert(audioMetadata)
      .values({
        assetId: input.assetId,
        category: input.data.category,
        genreTags: input.data.genreTags,
        moodTags: input.data.moodTags,
        language: input.data.language,
        artist: input.data.artist,
        bpm: input.data.bpm,
        musicalKey: input.data.musicalKey,
        sourcePlatform: input.data.sourcePlatform,
        description: input.data.description,
      })
      .onConflictDoUpdate({
        target: audioMetadata.assetId,
        set: {
          category: input.data.category,
          genreTags: input.data.genreTags,
          moodTags: input.data.moodTags,
          language: input.data.language,
          artist: input.data.artist,
          bpm: input.data.bpm,
          musicalKey: input.data.musicalKey,
          sourcePlatform: input.data.sourcePlatform,
          description: input.data.description,
          updatedAt: new Date(),
        },
      })
  })

  return { assetId: input.assetId }
}

/** One track, for the edit form. Null when it is not in this project. */
export async function getMusic(
  projectId: string,
  assetId: string
): Promise<MusicTrack | null> {
  const [row] = await db
    .select({
      assetId: assets.id,
      title: assets.title,
      name: assets.name,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      durationSec: assets.durationSec,
      version: assets.version,
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
      category: audioMetadata.category,
      genreTags: audioMetadata.genreTags,
      moodTags: audioMetadata.moodTags,
      language: audioMetadata.language,
      artist: audioMetadata.artist,
      bpm: audioMetadata.bpm,
      musicalKey: audioMetadata.musicalKey,
      sourcePlatform: audioMetadata.sourcePlatform,
      description: audioMetadata.description,
      licenseStatus: assetLicenses.status,
    })
    .from(assets)
    .leftJoin(audioMetadata, eq(audioMetadata.assetId, assets.id))
    .leftJoin(
      assetLicenses,
      and(eq(assetLicenses.assetId, assets.id), isNull(assetLicenses.deletedAt))
    )
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.projectId, projectId),
        isNull(assets.deletedAt)
      )
    )
    .limit(1)

  if (!row) return null

  const [waveform] = await db
    .select({ id: assetVariants.id })
    .from(assetVariants)
    .where(
      and(
        eq(assetVariants.assetId, assetId),
        eq(assetVariants.kind, 'WAVEFORM'),
        eq(assetVariants.uploadStatus, 'COMPLETED')
      )
    )
    .limit(1)

  return {
    assetId: row.assetId,
    title: row.title,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationSec: row.durationSec,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: (row.category ?? 'OTHER') as MusicCategory,
    genreTags: row.genreTags ?? [],
    moodTags: row.moodTags ?? [],
    language: row.language ?? '',
    artist: row.artist ?? '',
    bpm: row.bpm,
    musicalKey: row.musicalKey ?? '',
    sourcePlatform: row.sourcePlatform ?? '',
    description: row.description ?? '',
    hasWaveform: Boolean(waveform),
    licenseStatus: row.licenseStatus ?? 'PENDING_REVIEW',
  }
}
