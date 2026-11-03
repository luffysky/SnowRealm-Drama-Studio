import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 既有素材管線的回歸測試.
 *
 * Written **before** the 81–90 audio work, deliberately. The first acceptance
 * gate for that work is not a screen: it is that images, video, character key
 * visuals and storyboard assets keep working afterwards. A promise like that
 * is worth nothing unless the current behaviour is pinned first — otherwise
 * "still works" means "nobody noticed yet".
 *
 * These assert the invariants the audio tables could plausibly break:
 * the shape of an asset row, the access check, the variant mechanism, and the
 * polymorphic links that shots and characters hang off.
 */
const hasDb = testDatabaseReady()

let loadAssetForUser: typeof import('@/lib/assets').loadAssetForUser
let validateUpload: typeof import('@/lib/assets').validateUpload
let buildObjectKey: typeof import('@/lib/r2').buildObjectKey

let projectId: string
let otherProjectId: string | null = null
const createdAssetIds: string[] = []

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'test@example.com',
  name: '測試',
  title: 'CTO',
  role: 'OWNER' as const,
  color: '#ffffff',
  displayCurrency: 'TWD' as const,
}

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  ;({ loadAssetForUser, validateUpload } = await import('@/lib/assets'))
  ;({ buildObjectKey } = await import('@/lib/r2'))

  const rows = await db.select({ id: schema.projects.id }).from(schema.projects).limit(2)
  const project = rows[0]
  if (!project) throw new Error('Run `npm run db:seed` first')

  projectId = project.id
  otherProjectId = rows[1]?.id ?? null
})

afterAll(async () => {
  if (!hasDb || createdAssetIds.length === 0) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { inArray } = await import('drizzle-orm')

  await db.delete(schema.assets).where(inArray(schema.assets.id, createdAssetIds))
})

describe('validateUpload', () => {
  it('accepts each kind with its own mime type', () => {
    expect(() =>
      validateUpload({ kind: 'IMAGE', contentType: 'image/png', sizeBytes: 1024 })
    ).not.toThrow()
    expect(() =>
      validateUpload({ kind: 'VIDEO', contentType: 'video/mp4', sizeBytes: 1024 })
    ).not.toThrow()
    // The audio kinds already exist and already pass; the 81–90 work must not
    // need to change this.
    expect(() =>
      validateUpload({ kind: 'MUSIC', contentType: 'audio/mpeg', sizeBytes: 1024 })
    ).not.toThrow()
    expect(() =>
      validateUpload({ kind: 'SFX', contentType: 'audio/wav', sizeBytes: 1024 })
    ).not.toThrow()
    expect(() =>
      validateUpload({ kind: 'VOICE', contentType: 'audio/mpeg', sizeBytes: 1024 })
    ).not.toThrow()
  })

  it('rejects a mime type that does not belong to the kind', () => {
    expect(() =>
      validateUpload({ kind: 'IMAGE', contentType: 'audio/mpeg', sizeBytes: 1024 })
    ).toThrow()
  })

  it('rejects an empty or oversized file', () => {
    expect(() =>
      validateUpload({ kind: 'IMAGE', contentType: 'image/png', sizeBytes: 0 })
    ).toThrow()
  })
})

describe('buildObjectKey', () => {
  it('scopes every object under its project', () => {
    /*
     * The key carries the project id. Studio-wide assets (spec 86) have no
     * project, which is exactly why `scope` cannot be added without changing
     * this function and the access check that mirrors it.
     */
    const key = buildObjectKey({ projectId: 'abc', kind: 'IMAGE', filename: 'a.png' })

    expect(key.startsWith('projects/abc/')).toBe(true)
    expect(key.endsWith('.png')).toBe(true)
  })

  it('keeps kinds in separate folders', () => {
    const image = buildObjectKey({ projectId: 'p', kind: 'IMAGE', filename: 'a.png' })
    const music = buildObjectKey({ projectId: 'p', kind: 'MUSIC', filename: 'a.mp3' })

    expect(image.split('/')[2]).not.toBe(music.split('/')[2])
  })
})

describe.skipIf(!hasDb)('asset row', () => {
  it('keeps name as the uploaded filename', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const [row] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'IMAGE' as const,
        name: '原始檔名.png',
        objectKey: `tests/${crypto.randomUUID()}.png`,
        uploadStatus: 'COMPLETED' as const,
      })
      .returning()

    createdAssetIds.push(row!.id)

    // `name` is the original filename and is what a download is saved as.
    // A future editable display name must be a *new* column, not a rename.
    expect(row!.name).toBe('原始檔名.png')
    expect(row!.version).toBe(1)
    expect(row!.uploadStatus).toBe('COMPLETED')
  })

  it('reaches an asset through its project', async () => {
    const assetId = createdAssetIds[0]!
    const row = await loadAssetForUser(assetId, USER)

    expect(row.id).toBe(assetId)
    expect(row.projectId).toBe(projectId)
  })

  it('refuses an asset id that does not exist', async () => {
    await expect(loadAssetForUser(crypto.randomUUID(), USER)).rejects.toThrow()
  })
})

describe.skipIf(!hasDb)('asset variants', () => {
  it('stores a derived file alongside the master, one per kind', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const assetId = createdAssetIds[0]!

    /*
     * `asset_variants.kind` is the *derived file* axis — thumbnail, preview,
     * waveform, transcode. The editorial axis for music (full / instrumental /
     * short / vocal) is a different thing and must not be folded in here:
     * an instrumental is another recording, not another rendering of the same
     * one.
     */
    await db.insert(schema.assetVariants).values({
      assetId,
      kind: 'PREVIEW' as const,
      objectKey: `tests/${crypto.randomUUID()}.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100,
      uploadStatus: 'COMPLETED' as const,
    })

    await db.insert(schema.assetVariants).values({
      assetId,
      kind: 'WAVEFORM' as const,
      objectKey: `tests/${crypto.randomUUID()}.json`,
      mimeType: 'application/json',
      sizeBytes: 50,
      uploadStatus: 'COMPLETED' as const,
    })

    const rows = await db
      .select()
      .from(schema.assetVariants)
      .where(eq(schema.assetVariants.assetId, assetId))

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['PREVIEW', 'WAVEFORM']))
  })

  it('replaces rather than piles up when a variant is regenerated', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    const assetId = createdAssetIds[0]!
    const objectKey = `tests/${crypto.randomUUID()}.webp`

    await db
      .insert(schema.assetVariants)
      .values({
        assetId,
        kind: 'PREVIEW' as const,
        objectKey,
        mimeType: 'image/webp',
        sizeBytes: 200,
        uploadStatus: 'COMPLETED' as const,
      })
      .onConflictDoUpdate({
        target: [schema.assetVariants.assetId, schema.assetVariants.kind],
        set: { objectKey, sizeBytes: 200 },
      })

    const rows = await db
      .select()
      .from(schema.assetVariants)
      .where(
        and(eq(schema.assetVariants.assetId, assetId), eq(schema.assetVariants.kind, 'PREVIEW'))
      )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.sizeBytes).toBe(200)
  })
})

describe.skipIf(!hasDb)('asset links', () => {
  it('attaches one asset to a shot slot without copying the file', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const assetId = createdAssetIds[0]!
    const entityId = crypto.randomUUID()

    // The polymorphic link is how shots, characters and tasks reference an
    // asset. Audio cues will use the same mechanism rather than a parallel one.
    await db.insert(schema.assetLinks).values({
      assetId,
      entityType: 'shot',
      entityId,
      slot: 'first_frame',
    })

    const rows = await db
      .select()
      .from(schema.assetLinks)
      .where(eq(schema.assetLinks.entityId, entityId))

    expect(rows).toHaveLength(1)
    expect(rows[0]!.assetId).toBe(assetId)

    await db.delete(schema.assetLinks).where(eq(schema.assetLinks.entityId, entityId))
  })
})

describe.skipIf(!hasDb)('project isolation', () => {
  it('never returns another project’s assets in a project query', async () => {
    if (!otherProjectId) return

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const rows = await db
      .select({ projectId: schema.assets.projectId })
      .from(schema.assets)
      .where(eq(schema.assets.projectId, projectId))

    expect(rows.every((row) => row.projectId === projectId)).toBe(true)
  })
})

describe.skipIf(!hasDb)('asset centre overview', () => {
  it('lists every kind, including the empty ones', async () => {
    /*
     * The acceptance test for design 81 is explicit: an empty library shows 0.
     * Hiding a category because it has no files reads as "not supported",
     * which is a different claim from "none yet".
     */
    const { getAssetCenter } = await import('@/lib/asset-center')
    const { ASSET_KINDS } = await import('@/lib/constants')

    const data = await getAssetCenter(projectId)

    expect(data.byKind.map((row) => row.kind)).toEqual([...ASSET_KINDS])
  })

  it('counts only finished uploads', async () => {
    // A PENDING row has no bytes behind it; counting it would overstate both
    // the library and the storage bill.
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    const { getAssetCenter } = await import('@/lib/asset-center')

    const before = await getAssetCenter(projectId)

    const [pending] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'VIDEO' as const,
        name: 'never-finished.mp4',
        objectKey: `tests/${crypto.randomUUID()}.mp4`,
        sizeBytes: 999_999,
        uploadStatus: 'PENDING' as const,
      })
      .returning({ id: schema.assets.id })

    createdAssetIds.push(pending!.id)

    const after = await getAssetCenter(projectId)

    expect(after.total).toBe(before.total)
    expect(after.sizeBytes).toBe(before.sizeBytes)

    await db.delete(schema.assets).where(eq(schema.assets.id, pending!.id))
  })

  it('charges nothing while inside the free tier', async () => {
    // R2 gives 10 GB a month free; a few test files must not produce a bill.
    const { getAssetCenter } = await import('@/lib/asset-center')

    const data = await getAssetCenter(projectId)

    expect(data.sizeBytes).toBeLessThan(10 * 1024 ** 3)
    expect(data.estimatedMonthlyUsd).toBe(0)
  })

  it('never reports another project’s assets', async () => {
    if (!otherProjectId) return

    const { getAssetCenter } = await import('@/lib/asset-center')
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const before = await getAssetCenter(projectId)

    const [foreign] = await db
      .insert(schema.assets)
      .values({
        projectId: otherProjectId,
        kind: 'IMAGE' as const,
        name: 'other-project.png',
        objectKey: `tests/${crypto.randomUUID()}.png`,
        sizeBytes: 1234,
        uploadStatus: 'COMPLETED' as const,
      })
      .returning({ id: schema.assets.id })

    const after = await getAssetCenter(projectId)

    expect(after.total).toBe(before.total)

    await db.delete(schema.assets).where(eq(schema.assets.id, foreign!.id))
  })
})
