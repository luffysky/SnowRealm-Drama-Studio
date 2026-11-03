import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  dramaTitleOf,
  hasDistinctTitles,
  novelTitleOf,
  searchableTitles,
} from '@/lib/project-titles'
import { testDatabaseReady } from './helpers/database'

/**
 * 作品設定: the cover, and the three names.
 *
 * The naming rules are pure and tested without a database. `updateProject`
 * needs one, because the whole point of it is the checks it runs against
 * other rows — a cover id from another project must not be accepted.
 */

describe('project titles', () => {
  const work = { title: '一灶見山河', novelTitle: '', dramaTitle: '' }

  it('falls back to the work title when a name is not set', () => {
    expect(novelTitleOf(work)).toBe('一灶見山河')
    expect(dramaTitleOf(work)).toBe('一灶見山河')
  })

  it('lets the novel and the drama carry different names', () => {
    const project = { title: '一灶見山河', novelTitle: '灶前山河', dramaTitle: '萬家燈火' }

    expect(novelTitleOf(project)).toBe('灶前山河')
    expect(dramaTitleOf(project)).toBe('萬家燈火')
  })

  it('treats a whitespace-only name as unset', () => {
    // Otherwise a stray space would make the header print an empty title.
    expect(novelTitleOf({ title: '一灶見山河', novelTitle: '   ' })).toBe('一灶見山河')
  })

  it('says nothing is distinct when every name matches', () => {
    expect(hasDistinctTitles(work)).toBe(false)
    expect(
      hasDistinctTitles({ title: '一灶見山河', novelTitle: '一灶見山河', dramaTitle: '' })
    ).toBe(false)
  })

  it('indexes every distinct name exactly once', () => {
    // A member who only remembers the drama's release name must still find
    // the work, and the project row should not be padded with duplicates.
    expect(
      searchableTitles({ title: '一灶見山河', novelTitle: '', dramaTitle: '萬家燈火' })
    ).toEqual(['一灶見山河', '萬家燈火'])

    expect(searchableTitles(work)).toEqual(['一灶見山河'])
  })
})

const hasDb = testDatabaseReady()

let updateProject: typeof import('@/lib/projects').updateProject
let projectId: string
let otherProjectId: string | null = null
let originalTitles: { title: string; novelTitle: string; dramaTitle: string }
let originalCover: string | null = null
const createdAssetIds: string[] = []

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  ;({ updateProject } = await import('@/lib/projects'))

  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      novelTitle: schema.projects.novelTitle,
      dramaTitle: schema.projects.dramaTitle,
      coverAssetId: schema.projects.coverAssetId,
    })
    .from(schema.projects)
    .limit(2)

  const project = rows[0]
  if (!project) throw new Error('Run `npm run db:seed` first')

  projectId = project.id
  otherProjectId = rows[1]?.id ?? null
  originalCover = project.coverAssetId
  originalTitles = {
    title: project.title,
    novelTitle: project.novelTitle,
    dramaTitle: project.dramaTitle,
  }

  // Two assets to test the cover checks against: one usable image, one video.
  const inserted = await db
    .insert(schema.assets)
    .values([
      {
        projectId,
        kind: 'IMAGE' as const,
        name: 'test-cover.png',
        objectKey: `tests/${crypto.randomUUID()}.png`,
        uploadStatus: 'COMPLETED' as const,
      },
      {
        projectId,
        kind: 'VIDEO' as const,
        name: 'test-clip.mp4',
        objectKey: `tests/${crypto.randomUUID()}.mp4`,
        uploadStatus: 'COMPLETED' as const,
      },
      {
        projectId,
        kind: 'IMAGE' as const,
        name: 'test-pending.png',
        objectKey: `tests/${crypto.randomUUID()}.png`,
        uploadStatus: 'PENDING' as const,
      },
    ])
    .returning({ id: schema.assets.id })

  createdAssetIds.push(...inserted.map((row) => row.id))
})

afterAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { eq, inArray } = await import('drizzle-orm')

  await db
    .update(schema.projects)
    .set({ ...originalTitles, coverAssetId: originalCover })
    .where(eq(schema.projects.id, projectId))

  if (createdAssetIds.length > 0) {
    await db.delete(schema.assets).where(inArray(schema.assets.id, createdAssetIds))
  }
})

describe.skipIf(!hasDb)('updateProject', () => {
  it('stores an empty novel title rather than a copy of the work title', async () => {
    // A copy would stop following the work's name the moment it was renamed,
    // which is exactly the bug the empty-string convention avoids.
    const row = await updateProject(projectId, 'any-user', { novelTitle: '' })

    expect(row?.novelTitle).toBe('')
    expect(novelTitleOf(row!)).toBe(row!.title)
  })

  it('saves distinct novel and drama names', async () => {
    const row = await updateProject(projectId, 'any-user', {
      novelTitle: '測試書名',
      dramaTitle: '測試劇名',
    })

    expect(row?.novelTitle).toBe('測試書名')
    expect(row?.dramaTitle).toBe('測試劇名')
  })

  it('leaves fields that were not sent alone', async () => {
    await updateProject(projectId, 'any-user', { novelTitle: '只改書名' })
    const row = await updateProject(projectId, 'any-user', { dramaTitle: '只改劇名' })

    expect(row?.novelTitle).toBe('只改書名')
  })

  it('accepts an image from this project as the cover', async () => {
    const assetId = createdAssetIds[0]!
    const row = await updateProject(projectId, 'any-user', { coverAssetId: assetId })

    expect(row?.coverAssetId).toBe(assetId)
  })

  it('clears the cover when given null', async () => {
    const row = await updateProject(projectId, 'any-user', { coverAssetId: null })

    expect(row?.coverAssetId).toBeNull()
  })

  it('refuses a cover that is not an image', async () => {
    // cover_asset_id has no foreign key and no type constraint, so without
    // this check a video id would be stored and render as a broken image.
    await expect(
      updateProject(projectId, 'any-user', { coverAssetId: createdAssetIds[1]! })
    ).rejects.toThrow(/圖片/)
  })

  it('refuses a cover whose upload never finished', async () => {
    await expect(
      updateProject(projectId, 'any-user', { coverAssetId: createdAssetIds[2]! })
    ).rejects.toThrow(/上傳完成/)
  })

  it('refuses an asset id that belongs to another project', async () => {
    if (!otherProjectId) return

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const [foreign] = await db
      .insert(schema.assets)
      .values({
        projectId: otherProjectId,
        kind: 'IMAGE' as const,
        name: 'other-project.png',
        objectKey: `tests/${crypto.randomUUID()}.png`,
        uploadStatus: 'COMPLETED' as const,
      })
      .returning({ id: schema.assets.id })

    createdAssetIds.push(foreign!.id)

    // Reading an asset across the project boundary is the real risk here,
    // not a broken image.
    await expect(
      updateProject(projectId, 'any-user', { coverAssetId: foreign!.id })
    ).rejects.toThrow(/不屬於這部作品/)
  })

  it('returns null for a project that does not exist', async () => {
    const missing = await updateProject(crypto.randomUUID(), 'any-user', { title: 'x' })

    expect(missing).toBeNull()
  })
})
