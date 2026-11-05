import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 角色多圖與定妝照 (Z167).
 *
 * 這一支盯的是三個不變式，而其中兩個是「很容易做半套」的那種：
 *
 *  1. 一個角色可以有很多張圖。
 *  2. **被選為定妝照的那一張，一定在圖庫裡。** 走上傳會自己建連結，但「把素
 *     材庫裡既有的一張設成定妝照」這條路不會——少了那一步，那張圖會是定妝照
 *     卻不出現在縮圖列，於是沒有任何辦法把它換掉。
 *  3. **移掉定妝照要有人遞補。** 留一個「有圖但沒有定妝照」的角色，等於安靜
 *     地讓分鏡與 AI 生圖失去樣貌參考——它們讀的就是 `key_visual_asset_id`。
 */
const hasDb = testDatabaseReady()

let getCharacters: typeof import('@/lib/characters').getCharacters
let updateCharacter: typeof import('@/lib/characters').updateCharacter
let unlinkCharacterPortrait: typeof import('@/lib/characters').unlinkCharacterPortrait
let findAssetReferences: typeof import('@/lib/assets').findAssetReferences
let CHARACTER_PORTRAIT_SLOT: string

let projectId: string
let characterId: string
/**
 * 這一支建立的所有角色，afterAll 一律清掉。
 *
 * `characters` 有 `unique(project_id, name)`，而測試中途失敗就不會跑到行內的
 * 清理——於是一列殘留會讓**之後每一次**執行都在 insert 爆掉。名字也帶一個隨
 * 機尾碼，這樣就算清理本身也失敗，下一次還是跑得起來。
 */
const createdCharacterIds: string[] = []
const suffix = Math.random().toString(36).slice(2, 8)
/** 三張圖，建立時間刻意錯開，好讓「最早的那一張」是個確定的答案。 */
const assetIds: string[] = []

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  ;({ getCharacters, updateCharacter, unlinkCharacterPortrait } = await import(
    '@/lib/characters'
  ))
  ;({ CHARACTER_PORTRAIT_SLOT } = await import('@/lib/constants'))
  ;({ findAssetReferences } = await import('@/lib/assets'))

  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
  if (!project) throw new Error('Run `npm run db:seed` first')
  projectId = project.id

  const [character] = await db
    .insert(schema.characters)
    .values({ projectId, name: `圖庫測試角色-${suffix}`, tier: 'MINOR' })
    .returning({ id: schema.characters.id })
  if (!character) throw new Error('Failed to create the test character')
  characterId = character.id
  createdCharacterIds.push(characterId)

  for (let index = 0; index < 3; index += 1) {
    const [asset] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'IMAGE',
        name: `portrait-${index}.png`,
        objectKey: `tests/character-portraits/${characterId}/${index}.png`,
        mimeType: 'image/png',
        uploadStatus: 'COMPLETED',
        // 錯開建立時間：遞補規則是「最早的那一張」，同一毫秒分不出先後。
        createdAt: new Date(Date.now() - (3 - index) * 60_000),
      })
      .returning({ id: schema.assets.id })
    if (!asset) throw new Error('Failed to create a test asset')
    assetIds.push(asset.id)
  }
})

afterAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { inArray } = await import('drizzle-orm')

  if (createdCharacterIds.length > 0) {
    await db
      .delete(schema.characters)
      .where(inArray(schema.characters.id, createdCharacterIds))
  }
  if (assetIds.length > 0) {
    // asset_links 的 FK 是 cascade，所以刪素材會把剩下的連結一起帶走。
    await db.delete(schema.assets).where(inArray(schema.assets.id, assetIds))
  }
})

describe.skipIf(!hasDb)('角色圖庫', () => {
  it('把既有素材設成定妝照時會補上圖庫連結', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    /*
     * 這張圖沒有走上傳，所以它**沒有** asset_links 那一列——這正是
     * `updateCharacter` 要補的情況。
     */
    const links = await db
      .select({ id: schema.assetLinks.id })
      .from(schema.assetLinks)
      .where(
        and(
          eq(schema.assetLinks.assetId, assetIds[0]!),
          eq(schema.assetLinks.entityId, characterId)
        )
      )
    expect(links).toHaveLength(0)

    await updateCharacter({
      projectId,
      characterId,
      patch: { keyVisualAssetId: assetIds[0]! },
    })

    const after = await db
      .select({ slot: schema.assetLinks.slot })
      .from(schema.assetLinks)
      .where(
        and(
          eq(schema.assetLinks.assetId, assetIds[0]!),
          eq(schema.assetLinks.entityId, characterId)
        )
      )
    expect(after).toHaveLength(1)
    expect(after[0]!.slot).toBe(CHARACTER_PORTRAIT_SLOT)
  })

  it('一個角色列得出多張圖，而且認得哪一張是定妝照', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    await db.insert(schema.assetLinks).values([
      {
        assetId: assetIds[1]!,
        entityType: 'character',
        entityId: characterId,
        slot: CHARACTER_PORTRAIT_SLOT,
      },
      {
        assetId: assetIds[2]!,
        entityType: 'character',
        entityId: characterId,
        slot: CHARACTER_PORTRAIT_SLOT,
      },
    ])

    const { characters } = await getCharacters(projectId)
    const row = characters.find((item) => item.id === characterId)

    expect(row).toBeDefined()
    expect(row!.portraits.map((p) => p.assetId)).toEqual(assetIds)
    expect(row!.keyVisualAssetId).toBe(assetIds[0])
    // label 沒設 title 就用原始檔名，不是空字串。
    expect(row!.portraits[0]!.label).toBe('portrait-0.png')
  })

  it('移掉不是定妝照的那一張，定妝照不動', async () => {
    const result = await unlinkCharacterPortrait({
      projectId,
      characterId,
      assetId: assetIds[2]!,
    })

    expect(result.wasPrimary).toBe(false)
    expect(result.promotedTo).toBeNull()

    const { characters } = await getCharacters(projectId)
    const row = characters.find((item) => item.id === characterId)!
    expect(row.portraits.map((p) => p.assetId)).toEqual([assetIds[0], assetIds[1]])
    expect(row.keyVisualAssetId).toBe(assetIds[0])
  })

  it('移掉定妝照時由最早的那一張遞補，而且說得出遞補到誰', async () => {
    const result = await unlinkCharacterPortrait({
      projectId,
      characterId,
      assetId: assetIds[0]!,
    })

    expect(result.wasPrimary).toBe(true)
    expect(result.promotedTo).toBe(assetIds[1])

    const { characters } = await getCharacters(projectId)
    const row = characters.find((item) => item.id === characterId)!
    expect(row.keyVisualAssetId).toBe(assetIds[1])
    expect(row.portraits.map((p) => p.assetId)).toEqual([assetIds[1]])
  })

  it('移掉最後一張就沒有定妝照了，而且回報沒有人遞補', async () => {
    const result = await unlinkCharacterPortrait({
      projectId,
      characterId,
      assetId: assetIds[1]!,
    })

    expect(result.wasPrimary).toBe(true)
    expect(result.promotedTo).toBeNull()

    const { characters } = await getCharacters(projectId)
    const row = characters.find((item) => item.id === characterId)!
    expect(row.keyVisualAssetId).toBeNull()
    expect(row.portraits).toEqual([])
  })

  it('移一張不在這個角色圖庫裡的圖會被擋下來', async () => {
    await expect(
      unlinkCharacterPortrait({ projectId, characterId, assetId: assetIds[0]! })
    ).rejects.toThrow()
  })

  /*
   * 以下三條是子代理審出來的漏測 (Z168).
   *
   * 前面六條方向對，但把查詢的三組條件拆掉之後它們**仍然全綠**：三張測試素
   * 材都是 COMPLETED 且沒軟刪，所以 `uploadStatus` 與 `deletedAt` 從來沒被
   * 行使；從來沒有建過別的 slot 或別的 entityType 的連結，所以
   * `CHARACTER_PORTRAIT_SLOT` 這個常數存在的理由沒有測試在守；而解連結只測
   * 了「圖不在圖庫裡」，沒測「拿別的專案的 characterId 來解」。
   */

  it('沒傳完的與被軟刪的素材不進圖庫，也不會被遞補成定妝照', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const extra = await db
      .insert(schema.assets)
      .values([
        {
          projectId,
          kind: 'IMAGE' as const,
          name: 'pending.png',
          objectKey: `tests/character-portraits/${characterId}/pending.png`,
          mimeType: 'image/png',
          uploadStatus: 'PENDING' as const,
          createdAt: new Date(Date.now() - 50_000),
        },
        {
          projectId,
          kind: 'IMAGE' as const,
          name: 'deleted.png',
          objectKey: `tests/character-portraits/${characterId}/deleted.png`,
          mimeType: 'image/png',
          uploadStatus: 'COMPLETED' as const,
          deletedAt: new Date(),
          createdAt: new Date(Date.now() - 40_000),
        },
        {
          projectId,
          kind: 'IMAGE' as const,
          name: 'live.png',
          objectKey: `tests/character-portraits/${characterId}/live.png`,
          mimeType: 'image/png',
          uploadStatus: 'COMPLETED' as const,
          createdAt: new Date(Date.now() - 30_000),
        },
      ])
      .returning({ id: schema.assets.id })

    for (const row of extra) assetIds.push(row.id)
    const [pendingId, deletedId, liveId] = extra.map((row) => row.id) as [string, string, string]

    await db.insert(schema.assetLinks).values(
      [pendingId, deletedId, liveId].map((assetId) => ({
        assetId,
        entityType: 'character',
        entityId: characterId,
        slot: CHARACTER_PORTRAIT_SLOT,
      }))
    )

    // 圖庫裡只該有 live 那一張。
    const first = await getCharacters(projectId)
    const before = first.characters.find((item) => item.id === characterId)!
    expect(before.portraits.map((portrait) => portrait.assetId)).toEqual([liveId])

    /*
     * 遞補也要用同一組條件。
     *
     * pending 與 deleted 的 createdAt 都比 live 早，所以「最早的那一張」如果
     * 沒有濾掉它們，遞補到的會是一張傳不完或已經刪掉的圖。
     */
    await updateCharacter({ projectId, characterId, patch: { keyVisualAssetId: liveId } })
    const result = await unlinkCharacterPortrait({ projectId, characterId, assetId: liveId })

    expect(result.wasPrimary).toBe(true)
    expect(result.promotedTo).toBeNull()

    const after = await getCharacters(projectId)
    expect(after.characters.find((item) => item.id === characterId)!.keyVisualAssetId).toBeNull()
  })

  it('別的 slot 與別的 entity_type 的連結不算角色圖', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const [asset] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'IMAGE',
        name: 'other-slot.png',
        objectKey: `tests/character-portraits/${characterId}/other-slot.png`,
        mimeType: 'image/png',
        uploadStatus: 'COMPLETED',
      })
      .returning({ id: schema.assets.id })
    assetIds.push(asset!.id)

    await db.insert(schema.assetLinks).values([
      // 同一個角色，但這是分鏡參考圖的 slot，不是定妝照那一格。
      {
        assetId: asset!.id,
        entityType: 'character',
        entityId: characterId,
        slot: 'ref',
      },
      // entity_id 剛好同一個 uuid，但指的是別種東西。
      {
        assetId: asset!.id,
        entityType: 'shot',
        entityId: characterId,
        slot: CHARACTER_PORTRAIT_SLOT,
      },
    ])

    const { characters } = await getCharacters(projectId)
    const row = characters.find((item) => item.id === characterId)!
    expect(row.portraits).toEqual([])

    // 也不能從別的 slot 把它解掉——那一列不屬於定妝照這一格。
    await expect(
      unlinkCharacterPortrait({ projectId, characterId, assetId: asset!.id })
    ).rejects.toThrow()
  })

  it('角色被軟刪之後，它的圖不再算被引用——不然那張圖永遠刪不掉', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [ghost] = await db
      .insert(schema.characters)
      .values({ projectId, name: `等著被軟刪的角色-${suffix}`, tier: 'MINOR' })
      .returning({ id: schema.characters.id })
    createdCharacterIds.push(ghost!.id)

    const [asset] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'IMAGE',
        name: 'ghost.png',
        objectKey: `tests/character-portraits/${ghost!.id}/ghost.png`,
        mimeType: 'image/png',
        uploadStatus: 'COMPLETED',
      })
      .returning({ id: schema.assets.id })
    assetIds.push(asset!.id)

    await db.insert(schema.assetLinks).values({
      assetId: asset!.id,
      entityType: 'character',
      entityId: ghost!.id,
      slot: CHARACTER_PORTRAIT_SLOT,
    })

    // 角色還活著的時候，那張圖當然算被引用——素材中心不該讓人刪掉它。
    const whileAlive = await findAssetReferences(asset!.id)
    expect(whileAlive.some((reference) => reference.entityType === 'character')).toBe(true)

    await db
      .update(schema.characters)
      .set({ deletedAt: new Date() })
      .where(eq(schema.characters.id, ghost!.id))

    /*
     * 軟刪之後就不算了。
     *
     * 不這樣的話是一條死路：角色已經從角色頁消失，沒有任何介面能解除那個連
     * 結，`unlinkCharacterPortrait` 也因為角色被軟刪而回 404，而全專案沒有
     * 角色還原路徑——那張圖會永遠卡在「仍被 1 處引用」。
     */
    const whileDeleted = await findAssetReferences(asset!.id)
    expect(whileDeleted.some((reference) => reference.entityType === 'character')).toBe(false)
  })

  it('拿別的專案的 id 來解連結會被擋下來', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const [asset] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'IMAGE',
        name: 'scoped.png',
        objectKey: `tests/character-portraits/${characterId}/scoped.png`,
        mimeType: 'image/png',
        uploadStatus: 'COMPLETED',
      })
      .returning({ id: schema.assets.id })
    assetIds.push(asset!.id)

    await db.insert(schema.assetLinks).values({
      assetId: asset!.id,
      entityType: 'character',
      entityId: characterId,
      slot: CHARACTER_PORTRAIT_SLOT,
    })

    /*
     * 角色是真的、圖也真的在它的圖庫裡——錯的只有 projectId。
     * 拿掉 `eq(characters.projectId, ...)` 這一條，這一條就會變綠。
     */
    await expect(
      unlinkCharacterPortrait({
        projectId: '00000000-0000-4000-8000-0000000000ff',
        characterId,
        assetId: asset!.id,
      })
    ).rejects.toThrow()

    // 用對的 projectId 就該成功，證明上面擋下來的原因真的是範圍而不是別的。
    const result = await unlinkCharacterPortrait({
      projectId,
      characterId,
      assetId: asset!.id,
    })
    expect(result.wasPrimary).toBe(false)
  })
})
