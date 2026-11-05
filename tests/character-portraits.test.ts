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
let CHARACTER_PORTRAIT_SLOT: string

let projectId: string
let characterId: string
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

  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
  if (!project) throw new Error('Run `npm run db:seed` first')
  projectId = project.id

  const [character] = await db
    .insert(schema.characters)
    .values({ projectId, name: '圖庫測試角色', tier: 'MINOR' })
    .returning({ id: schema.characters.id })
  if (!character) throw new Error('Failed to create the test character')
  characterId = character.id

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
  if (!hasDb || !characterId) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { inArray, eq } = await import('drizzle-orm')

  await db.delete(schema.characters).where(eq(schema.characters.id, characterId))
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
})
