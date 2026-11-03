import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 集數成片 (Z1).
 *
 * `episodes.final_asset_id` carries no foreign key and no type constraint —
 * consistent with every other asset reference in this schema — so every rule
 * about what may be a final cut lives in `updateEpisodeFinalCut()`. If these
 * stop passing, the database will silently accept a still image or another
 * project's file as a finished episode.
 */
const hasDb = testDatabaseReady()

let updateEpisodeFinalCut: typeof import('@/lib/episodes').updateEpisodeFinalCut
let episodeCuts: typeof import('@/lib/episodes').episodeCuts

let projectId: string
let otherProjectId: string | null = null
let episodeId: string
let originalFinal: string | null = null
const createdAssetIds: string[] = []

async function makeAsset(input: {
  projectId: string
  kind: 'VIDEO' | 'IMAGE'
  status: 'COMPLETED' | 'PENDING'
  episodeId?: string | null
  version?: number
}) {
  const { db } = await import('@/db')
  const schema = await import('@/db/schema')

  const [row] = await db
    .insert(schema.assets)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      kind: input.kind,
      name: `test-${crypto.randomUUID()}.mp4`,
      objectKey: `tests/${crypto.randomUUID()}.mp4`,
      uploadStatus: input.status,
      version: input.version ?? 1,
    })
    .returning({ id: schema.assets.id })

  createdAssetIds.push(row!.id)
  return row!.id
}

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')
  ;({ updateEpisodeFinalCut, episodeCuts } = await import('@/lib/episodes'))

  const projects = await db.select({ id: schema.projects.id }).from(schema.projects).limit(2)
  const project = projects[0]
  if (!project) throw new Error('Run `npm run db:seed` first')

  projectId = project.id
  otherProjectId = projects[1]?.id ?? null

  const [episode] = await db
    .select({ id: schema.episodes.id, finalAssetId: schema.episodes.finalAssetId })
    .from(schema.episodes)
    .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
    .limit(1)
  if (!episode) throw new Error('no episodes')

  episodeId = episode.id
  originalFinal = episode.finalAssetId
})

afterAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { eq, inArray } = await import('drizzle-orm')

  await db
    .update(schema.episodes)
    .set({ finalAssetId: originalFinal })
    .where(eq(schema.episodes.id, episodeId))

  if (createdAssetIds.length > 0) {
    await db.delete(schema.assets).where(inArray(schema.assets.id, createdAssetIds))
  }
})

describe.skipIf(!hasDb)('updateEpisodeFinalCut', () => {
  it('accepts a completed video from this project', async () => {
    const assetId = await makeAsset({
      projectId,
      kind: 'VIDEO',
      status: 'COMPLETED',
      episodeId,
    })

    const row = await updateEpisodeFinalCut(projectId, episodeId, assetId)

    expect(row?.finalAssetId).toBe(assetId)
  })

  it('refuses a still image', async () => {
    /*
     * The cover is an image and the final cut is a video; nothing in the
     * database distinguishes the two columns, so this is the only thing that
     * stops a cover being set as a finished episode.
     */
    const assetId = await makeAsset({ projectId, kind: 'IMAGE', status: 'COMPLETED' })

    await expect(updateEpisodeFinalCut(projectId, episodeId, assetId)).rejects.toThrow(/影片/)
  })

  it('refuses a video whose upload never finished', async () => {
    const assetId = await makeAsset({ projectId, kind: 'VIDEO', status: 'PENDING' })

    await expect(updateEpisodeFinalCut(projectId, episodeId, assetId)).rejects.toThrow(/上傳完成/)
  })

  it('refuses a video belonging to another project', async () => {
    if (!otherProjectId) return

    const assetId = await makeAsset({
      projectId: otherProjectId,
      kind: 'VIDEO',
      status: 'COMPLETED',
    })

    await expect(updateEpisodeFinalCut(projectId, episodeId, assetId)).rejects.toThrow(
      /不屬於這部作品/
    )
  })

  it('clears the cut when given null', async () => {
    const row = await updateEpisodeFinalCut(projectId, episodeId, null)

    expect(row?.finalAssetId).toBeNull()
  })

  it('returns null for an episode that is not in this project', async () => {
    const row = await updateEpisodeFinalCut(projectId, crypto.randomUUID(), null)

    expect(row).toBeNull()
  })
})

describe.skipIf(!hasDb)('episodeCuts', () => {
  it('keeps earlier cuts available after switching', async () => {
    /*
     * The point of the design: re-editing uploads a new file and moves the
     * pointer. The previous cut is still there and can be promoted back, so a
     * released episode remains traceable to the file that shipped.
     */
    const v1 = await makeAsset({
      projectId,
      kind: 'VIDEO',
      status: 'COMPLETED',
      episodeId,
      version: 1,
    })
    const v2 = await makeAsset({
      projectId,
      kind: 'VIDEO',
      status: 'COMPLETED',
      episodeId,
      version: 2,
    })

    await updateEpisodeFinalCut(projectId, episodeId, v2)
    const after = await episodeCuts(projectId, episodeId)

    expect(after.current?.assetId).toBe(v2)
    expect(after.history.map((row) => row.assetId)).toContain(v1)
  })

  it('reports no current cut when none is set', async () => {
    await updateEpisodeFinalCut(projectId, episodeId, null)
    const cuts = await episodeCuts(projectId, episodeId)

    expect(cuts.current).toBeNull()
    // The uploaded videos are still listed as candidates.
    expect(cuts.history.length).toBeGreaterThan(0)
  })
})
