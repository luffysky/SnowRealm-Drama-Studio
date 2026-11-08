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

    expect(key.startsWith('projects/abc/originals/')).toBe(true)
    expect(key.endsWith('.png')).toBe(true)
  })

  it('keeps kinds in separate folders', () => {
    const image = buildObjectKey({ projectId: 'p', kind: 'IMAGE', filename: 'a.png' })
    const music = buildObjectKey({ projectId: 'p', kind: 'MUSIC', filename: 'a.mp3' })

    expect(image).toContain('/originals/image/')
    expect(music).toContain('/originals/music/')
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

describe.skipIf(!hasDb)('music library', () => {
  const trackIds: string[] = []

  it('pages, filters and searches in SQL', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { inArray } = await import('drizzle-orm')
    const { listMusic } = await import('@/lib/music-library')

    // Three tracks that differ in every dimension the filters use.
    const fixtures = [
      { title: '主題曲', category: 'OP' as const, genre: '古風', mood: '磅礡' },
      { title: '市集喧嘩', category: 'BGM' as const, genre: '生活', mood: '輕快' },
      { title: '灶火暖心', category: 'BGM' as const, genre: '日常', mood: '溫馨' },
    ]

    for (const fixture of fixtures) {
      const [asset] = await db
        .insert(schema.assets)
        .values({
          projectId,
          kind: 'MUSIC' as const,
          name: `${fixture.title}.mp3`,
          title: fixture.title,
          objectKey: `tests/${crypto.randomUUID()}.mp3`,
          uploadStatus: 'COMPLETED' as const,
          durationSec: 180,
        })
        .returning({ id: schema.assets.id })

      trackIds.push(asset!.id)
      createdAssetIds.push(asset!.id)

      await db.insert(schema.audioMetadata).values({
        assetId: asset!.id,
        category: fixture.category,
        genreTags: [fixture.genre],
        moodTags: [fixture.mood],
        artist: '測試樂手',
      })
    }

    const all = await listMusic(projectId, { perPage: 50 })
    expect(all.rows.length).toBeGreaterThanOrEqual(3)

    const bgm = await listMusic(projectId, { category: 'BGM', perPage: 50 })
    expect(bgm.rows.every((row) => row.category === 'BGM')).toBe(true)
    expect(bgm.rows.length).toBeGreaterThanOrEqual(2)

    const byMood = await listMusic(projectId, { mood: '溫馨', perPage: 50 })
    expect(byMood.rows.every((row) => row.moodTags.includes('溫馨'))).toBe(true)

    const searched = await listMusic(projectId, { q: '市集', perPage: 50 })
    expect(searched.rows.some((row) => row.title === '市集喧嘩')).toBe(true)

    await db.delete(schema.audioMetadata).where(inArray(schema.audioMetadata.assetId, trackIds))
  })

  it('clamps a page past the end rather than returning nothing', async () => {
    // Narrowing a filter while on page 9 would otherwise strand the reader.
    const { listMusic } = await import('@/lib/music-library')

    const result = await listMusic(projectId, { page: 999, perPage: 5 })

    expect(result.page).toBe(result.pageCount)
  })

  it('never lists a track whose upload did not finish', async () => {
    /*
     * 「無音檔不顯示假曲目」. A PENDING row has no audio behind it, so a
     * library that listed it would offer a play button that cannot work.
     */
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    const { listMusic } = await import('@/lib/music-library')

    const [pending] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'MUSIC' as const,
        name: 'half-uploaded.mp3',
        title: '沒傳完的歌',
        objectKey: `tests/${crypto.randomUUID()}.mp3`,
        uploadStatus: 'PENDING' as const,
      })
      .returning({ id: schema.assets.id })

    const result = await listMusic(projectId, { perPage: 50 })

    expect(result.rows.some((row) => row.assetId === pending!.id)).toBe(false)

    await db.delete(schema.assets).where(eq(schema.assets.id, pending!.id))
  })
})

describe.skipIf(!hasDb)('上傳時 linkTo 的歸屬（Z169）', () => {
  /*
   * `beginUpload` 驗了 `episodeId` 屬於本作品，但 `linkTo.entityId` 完全沒
   * 驗：手動發一個 `projectId` 填 A、`linkTo` 指向 B 作品某個角色的請求，那一
   * 列 `asset_links` 就建起來了。
   *
   * 今天這不是權限漏洞（這個 schema 沒有 per-project 成員），是資料完整性。
   * 測在**寫入端**：六個讀取端各防一次的話，六處裡忘一處洞就還在。
   *
   * ## 這一組自己建 fixture
   *
   * 第一版是去撈現成的資料（`select … limit 1`），抓不到就 `return`。而本地
   * 測試庫裡**一個角色都沒有**（`TEST_DATABASE_URL` 指的是本機那一座，跟應
   * 用程式用的 Neon 不是同一個），所以四條全部提早返回、全部是綠的、每一條
   * 0ms。這一段測的是「別的作品的東西掛不上來」，而它當時什麼都沒測。
   */
  let beginUpload: typeof import('@/lib/assets').beginUpload
  let ownerProjectId = ''
  let strangerProjectId = ''
  let ownedCharacterId = ''
  /** `entityType` → 那個作品裡真的存在的一個 id。 */
  const owned = new Map<string, string>()
  /*
   * 真的存在的使用者，不是檔案頂端那個寫死的 USER。
   *
   * `assets.uploaded_by_id` 有外鍵，而那個寫死的 id 在本機測試庫裡不存在，
   * 所以「掛得上去」那一條會死在外鍵上——而死在外鍵上跟「歸屬檢查擋下來」
   * 是兩回事，混在一起就分不出測到了沒有。
   *
   * fixture 自己插一個，不是去撈現成的：撈現成的等於宣告「這個庫裡至少有一
   * 個使用者」，而剛重置、還沒 seed 的叢集上那一條會紅，訊息還不會說原因。
   */
  let uploader = USER

  beforeAll(async () => {
    if (!hasDb) return
    ;({ beginUpload } = await import('@/lib/assets'))

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const stamp = Date.now()

    const made = await db
      .insert(schema.projects)
      .values([
        { title: 'Z169 甲', slug: `z169-a-${stamp}` },
        { title: 'Z169 乙', slug: `z169-b-${stamp}` },
      ])
      .returning({ id: schema.projects.id })

    ownerProjectId = made[0]?.id ?? ''
    strangerProjectId = made[1]?.id ?? ''

    const [person] = await db
      .insert(schema.users)
      .values({
        email: `z169-${stamp}@example.test`,
        name: 'Z169 上傳者',
        passwordHash: 'x',
      })
      .returning({ id: schema.users.id })
    if (person) uploader = { ...USER, id: person.id }

    /*
     * 六種 entity 各建一個，因為 `ownerOfLinkTarget` 是六條各自的查詢。
     * 只測 character 的話，另外五條 join 接錯表、或軟刪除漏濾，全都看不出來。
     */
    const [character] = await db
      .insert(schema.characters)
      .values({ projectId: ownerProjectId, name: 'Z169 角色' })
      .returning({ id: schema.characters.id })
    ownedCharacterId = character?.id ?? ''
    owned.set('character', ownedCharacterId)

    const [entry] = await db
      .insert(schema.worldEntries)
      .values({ projectId: ownerProjectId, title: 'Z169 條目' })
      .returning({ id: schema.worldEntries.id })
    owned.set('world_entry', entry?.id ?? '')

    const [task] = await db
      .insert(schema.tasks)
      .values({ projectId: ownerProjectId, title: 'Z169 任務' })
      .returning({ id: schema.tasks.id })
    owned.set('task', task?.id ?? '')

    const [expense] = await db
      .insert(schema.expenses)
      .values({ projectId: ownerProjectId, description: 'Z169 支出', amount: '1.0000' })
      .returning({ id: schema.expenses.id })
    owned.set('expense', expense?.id ?? '')

    // shot 與 document 自己沒有 project_id，掛在集數底下。
    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId: ownerProjectId, index: 1, title: 'Z169 卷一' })
      .returning({ id: schema.arcs.id })
    const [episode] = await db
      .insert(schema.episodes)
      .values({ projectId: ownerProjectId, arcId: arc!.id, number: 1, title: 'Z169 第一集' })
      .returning({ id: schema.episodes.id })

    const [shot] = await db
      .insert(schema.shots)
      .values({ episodeId: episode!.id, order: 1 })
      .returning({ id: schema.shots.id })
    owned.set('shot', shot?.id ?? '')

    const [document] = await db
      .insert(schema.documents)
      .values({ episodeId: episode!.id, kind: 'NOVEL' })
      .returning({ id: schema.documents.id })
    owned.set('document', document?.id ?? '')
  })

  afterAll(async () => {
    if (!hasDb) return
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { inArray } = await import('drizzle-orm')

    const ids = [ownerProjectId, strangerProjectId].filter(Boolean)
    // 角色、素材、連結都掛 `on delete cascade`，所以刪作品就乾淨了。
    if (ids.length > 0) {
      await db.delete(schema.projects).where(inArray(schema.projects.id, ids))
    }
    if (uploader.id !== USER.id) {
      const { eq } = await import('drizzle-orm')
      await db.delete(schema.users).where(eq(schema.users.id, uploader.id))
    }
  })

  const upload = (projectId: string, linkTo: { entityType: string; entityId: string }) =>
    beginUpload({
      user: uploader,
      projectId,
      kind: 'IMAGE',
      filename: 'z169.png',
      contentType: 'image/png',
      sizeBytes: 2048,
      linkTo,
    })

  it('fixture 真的建起來了', () => {
    // 這一條守的是上面那段註解：fixture 沒建成就該紅，不是讓其餘三條變空的。
    expect(ownerProjectId).not.toBe('')
    expect(strangerProjectId).not.toBe('')
    expect(ownedCharacterId).not.toBe('')
    expect(ownerProjectId).not.toBe(strangerProjectId)
    expect(uploader.id).not.toBe(USER.id)
    // 六種都要有，否則下面那一輪會變成「測了幾種算幾種」。
    expect([...owned.keys()].sort()).toEqual([
      'character',
      'document',
      'expense',
      'shot',
      'task',
      'world_entry',
    ])
    expect([...owned.values()].every(Boolean)).toBe(true)
  })

  it('拒絕掛到別的作品的角色身上', async () => {
    await expect(
      upload(strangerProjectId, { entityType: 'character', entityId: ownedCharacterId })
    ).rejects.toThrow('要掛上去的對象不屬於這個作品')
  })

  it('拒絕不存在的對象', async () => {
    await expect(
      upload(ownerProjectId, {
        entityType: 'character',
        entityId: '00000000-0000-4000-8000-0000000000ff',
      })
    ).rejects.toThrow('要掛上去的對象不屬於這個作品')
  })

  it('拒絕已經軟刪除的角色——那一列建了也沒有人讀得到', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [gone] = await db
      .insert(schema.characters)
      .values({ projectId: ownerProjectId, name: 'Z169 刪掉的', deletedAt: new Date() })
      .returning({ id: schema.characters.id })

    await expect(
      upload(ownerProjectId, { entityType: 'character', entityId: gone!.id })
    ).rejects.toThrow('要掛上去的對象不屬於這個作品')

    await db.delete(schema.characters).where(eq(schema.characters.id, gone!.id))
  })

  it('拒絕沒聽過的 entityType', async () => {
    /*
     * 驗證器已經把它限成六種，而這裡再擋一次是因為**新增第七種的時候會先忘
     * 記改 `ownerOfLinkTarget`**——那時候該發生的是上傳被拒絕，不是悄悄建一
     * 列沒人驗過的連結。
     */
    await expect(
      upload(ownerProjectId, { entityType: 'invoice', entityId: ownedCharacterId })
    ).rejects.toThrow('要掛上去的對象不屬於這個作品')
  })

  it('六種 entity 都認得出歸屬——別的作品的掛不上來，自己的掛得上去', async () => {
    /*
     * 原本只測 `character` 一種。另外五條 join 寫錯（例如 `shot` 接到別張
     * 表）、或 `document` 的軟刪除漏掉，全部看不出來——而每一條都是一個獨立
     * 的查詢，不是同一段程式的六次呼叫。
     */
    for (const [entityType, entityId] of owned) {
      await expect(
        upload(strangerProjectId, { entityType, entityId }),
        `${entityType} 應該被擋下來`
      ).rejects.toThrow('要掛上去的對象不屬於這個作品')

      const result = await upload(ownerProjectId, { entityType, entityId })
      expect(result.assetId, `${entityType} 應該掛得上去`).toBeTruthy()
    }
  })

  it('同一個作品的角色照樣掛得上去，而且連結真的建了', async () => {
    // 沒有這一條，上面四條用「永遠拒絕」也會全綠。
    const result = await upload(ownerProjectId, {
      entityType: 'character',
      entityId: ownedCharacterId,
    })

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    const links = await db
      .select({ entityId: schema.assetLinks.entityId })
      .from(schema.assetLinks)
      .where(
        and(
          eq(schema.assetLinks.assetId, result.assetId),
          eq(schema.assetLinks.entityType, 'character')
        )
      )

    expect(links.map((link) => link.entityId)).toEqual([ownedCharacterId])
  })
})
