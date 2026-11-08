import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isVocabularyValue,
  suggestVocabularyValue,
  vocabularyOptions,
  vocabularyTermLabel,
  VOCABULARY_KINDS,
  type VocabularyTerm,
} from '@/lib/vocabulary-view'
import { testDatabaseReady } from './helpers/database'

/**
 * 可以自己加選項的下拉（Z184）。
 *
 * 這個功能真正的風險不在「加得了嗎」，在**加完之後有沒有東西悄悄壞掉**：
 * 欄位從 pg enum 改成 text，所以資料庫不再替我們擋亂寫的值，而每一個會壞的
 * 地方都壞得很安靜（一個看不懂的代碼、一個空白的格子、一個重複的選項）。
 */

const term = (over: Partial<VocabularyTerm> & { value: string }): VocabularyTerm => ({
  id: `id-${over.value}`,
  kind: 'shot_size',
  label: over.value,
  ...over,
})

describe('選項清單（純算）', () => {
  it('內建的在前面，自訂的接在後面', () => {
    /*
     * 內建的順序是電影語言的標準階梯（大遠景 → 大特寫）。打亂它會讓一個照順
     * 序找的人找不到東西，所以自訂的只能接在後面。
     */
    const options = vocabularyOptions('shot_size', [
      term({ value: 'OTS', label: '過肩' }),
    ])

    expect(options[0]?.value).toBe('EWS')
    expect(options.at(-1)).toMatchObject({ value: 'OTS', label: '過肩', builtIn: false })
    expect(options.filter((option) => option.builtIn)).toHaveLength(8)
  })

  it('自訂的蓋不掉內建的值', () => {
    // 否則改一個標籤就能讓 `MS` 變成別的意思。
    const options = vocabularyOptions('shot_size', [term({ value: 'MS', label: '其實是特寫' })])

    expect(options.filter((option) => option.value === 'MS')).toHaveLength(1)
    expect(options.find((option) => option.value === 'MS')?.label).toBe('中景')
  })

  it('自訂的標籤跟內建撞了也不收', () => {
    /*
     * 新增的時候擋過一次，但**內建的標籤會改**：`MCU` 在 Z182 從「中近景」改
     * 成「近景」，而在那之前自己加一個叫「近景」的人，從那一刻起下拉裡就有兩
     * 個一模一樣的選項。
     */
    const options = vocabularyOptions('shot_size', [term({ value: 'JJ', label: '近景' })])
    expect(options.filter((option) => option.label === '近景')).toHaveLength(1)
    expect(options.find((option) => option.label === '近景')?.value).toBe('MCU')
  })

  it('別類的詞不會混進來', () => {
    const options = vocabularyOptions('shot_size', [
      term({ value: 'OTS', kind: 'camera_move', label: '過肩' }),
    ])
    expect(options.every((option) => option.builtIn)).toBe(true)
  })

  it('兩類都有內建選項', () => {
    for (const kind of VOCABULARY_KINDS) {
      expect(vocabularyOptions(kind, []).length).toBeGreaterThan(0)
    }
  })
})

describe('標籤查詢', () => {
  it('內建的查得到', () => {
    expect(vocabularyTermLabel('shot_size', 'MCU', [])).toBe('近景')
    expect(vocabularyTermLabel('camera_move', 'STATIC', [])).toBe('固定')
  })

  it('自訂的查得到', () => {
    expect(vocabularyTermLabel('shot_size', 'OTS', [term({ value: 'OTS', label: '過肩' })])).toBe(
      '過肩'
    )
  })

  it('查不到就回值本身，不回空字串', () => {
    /*
     * 這一欄現在是 text，所以資料庫裡可能留著一個已經被刪掉的自訂值。那時候
     * 畫面上要看得到 `HANDHELD_LOW`——空白會讓人以為那一格沒填，然後去「補
     * 上」，而那是把別人填過的東西蓋掉。
     */
    expect(vocabularyTermLabel('shot_size', 'HANDHELD_LOW', [])).toBe('HANDHELD_LOW')
  })
})

describe('代碼', () => {
  it('從英文標籤猜得出代碼', () => {
    expect(suggestVocabularyValue('over the shoulder')).toBe('OVER_THE_SHOULDER')
  })

  it('純中文猜不出來，就留白讓人自己填', () => {
    // 猜一個 `CUSTOM_3` 出來更糟：那個代碼會出現在 AI 提示詞與匯出的檔案裡。
    expect(suggestVocabularyValue('過肩鏡')).toBe('')
  })

  it('長相：大寫開頭的英數底線', () => {
    expect(isVocabularyValue('OTS')).toBe(true)
    expect(isVocabularyValue('OVER_THE_SHOULDER_2')).toBe(true)
    expect(isVocabularyValue('ots')).toBe(false)
    expect(isVocabularyValue('2SHOT')).toBe(false)
    expect(isVocabularyValue('OVER THE SHOULDER')).toBe(false)
    expect(isVocabularyValue('')).toBe(false)
  })
})

describe('哪幾個下拉可以開放自訂', () => {
  it('只有景別與運鏡', () => {
    /*
     * 這一條存在的理由是**提醒**，不是驗證：這個 schema 有 39 個 pg enum，而
     * 其中一半是程式在判斷的（上傳狀態、任務狀態、AI 任務狀態、通話狀態）。
     * 多一個值出來，完成判定、看板分欄、篩選器會各自用各自的方式忽略它。
     *
     * 要再開一種的時候這一條會紅，而那正是該停下來想一次的時刻。
     */
    expect([...VOCABULARY_KINDS]).toEqual(['shot_size', 'camera_move'])
  })

  it('開放的那兩欄在資料庫裡是 text，不是 enum', () => {
    // enum 加了值就刪不掉（Postgres 沒有 `DROP VALUE`），所以這兩件事綁在一起。
    const schema = readFileSync('src/db/schema/storyboard.ts', 'utf8')
    expect(schema).toContain("shotSize: text('shot_size')")
    expect(schema).toContain("camera: text('camera')")
  })
})

/* -------------------------------------------------------------------------- */

const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('寫進資料庫（Z184）', () => {
  let addVocabularyTerm: typeof import('@/lib/vocabulary').addVocabularyTerm
  let deleteVocabularyTerm: typeof import('@/lib/vocabulary').deleteVocabularyTerm
  let assertVocabularyValue: typeof import('@/lib/vocabulary').assertVocabularyValue
  let listVocabulary: typeof import('@/lib/vocabulary').listVocabulary

  /** 跟 lib 內部同一條算式：內建 ∪ 自訂。 */
  const optionsFor = async (kind: 'shot_size' | 'camera_move') =>
    vocabularyOptions(kind, await listVocabulary())

  let user = { id: '' } as import('@/lib/auth/session').SessionUser
  const created: string[] = []

  beforeAll(async () => {
    if (!hasDb) return
    ;({ addVocabularyTerm, deleteVocabularyTerm, assertVocabularyValue, listVocabulary } =
      await import('@/lib/vocabulary'))

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const [person] = await db
      .insert(schema.users)
      .values({
        email: `z184-${Date.now()}@example.test`,
        name: 'Z184 測試',
        passwordHash: 'x',
      })
      .returning({ id: schema.users.id })

    user = {
      id: person!.id,
      email: 'z184@example.test',
      name: 'Z184 測試',
      title: '',
      role: 'OWNER',
      color: '#fff',
      displayCurrency: 'TWD',
    } as import('@/lib/auth/session').SessionUser
  })

  afterAll(async () => {
    if (!hasDb) return
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq, inArray } = await import('drizzle-orm')
    if (created.length > 0) {
      await db
        .delete(schema.vocabularyTerms)
        .where(inArray(schema.vocabularyTerms.id, created))
    }
    if (user.id) await db.delete(schema.users).where(eq(schema.users.id, user.id))
  })

  it('加一個之後它就在清單裡', async () => {
    const term = await addVocabularyTerm({
      user,
      kind: 'shot_size',
      value: 'Z184_OTS',
      label: `Z184 過肩 ${Date.now()}`,
    })
    created.push(term.id)

    const options = await optionsFor('shot_size')
    expect(options.some((option) => option.value === 'Z184_OTS')).toBe(true)
    expect(options.find((option) => option.value === 'Z184_OTS')?.builtIn).toBe(false)
  })

  it('加進去之後那個值就存得進鏡頭了', async () => {
    await expect(assertVocabularyValue('shot_size', 'Z184_OTS')).resolves.toBeUndefined()
  })

  it('沒加過的值存不進去', async () => {
    // 欄位是 text，資料庫不會擋——所以這一關是唯一的一關。
    await expect(assertVocabularyValue('shot_size', 'NEVER_ADDED')).rejects.toThrow('不是有效的')
  })

  it('內建的值一直都存得進去', async () => {
    await expect(assertVocabularyValue('shot_size', 'MS')).resolves.toBeUndefined()
    await expect(assertVocabularyValue('camera_move', 'STATIC')).resolves.toBeUndefined()
  })

  it('沒帶這一欄就不檢查', async () => {
    // 只改秒數的 PATCH 不該為了兩個沒送出來的欄位查兩次詞彙表。
    await expect(assertVocabularyValue('shot_size', undefined)).resolves.toBeUndefined()
  })

  it('同一個值加兩次會被擋', async () => {
    await expect(
      addVocabularyTerm({ user, kind: 'shot_size', value: 'Z184_OTS', label: '另一個名字' })
    ).rejects.toThrow('已經在清單裡')
  })

  it('撞到內建的值也會被擋', async () => {
    await expect(
      addVocabularyTerm({ user, kind: 'shot_size', value: 'MS', label: '我的中景' })
    ).rejects.toThrow('已經在清單裡')
  })

  it('代碼長相不對會被擋', async () => {
    await expect(
      addVocabularyTerm({ user, kind: 'shot_size', value: '過肩', label: '過肩' })
    ).rejects.toThrow('大寫英文字母')
  })

  it('刪掉之後清單裡就沒有了，但值還是看得懂', async () => {
    const term = await addVocabularyTerm({
      user,
      kind: 'camera_move',
      value: 'Z184_WHIP',
      label: `Z184 甩鏡 ${Date.now()}`,
    })

    await deleteVocabularyTerm({ kind: 'camera_move', termId: term.id })

    const options = await optionsFor('camera_move')
    expect(options.some((option) => option.value === 'Z184_WHIP')).toBe(false)
    /*
     * 已經存了這個值的鏡頭不會被動到——這張表是「下拉裡有哪些選項」，不是
     * 「資料裡有哪些值」。畫面上那一格會顯示 `Z184_WHIP`。
     */
    expect(vocabularyTermLabel('camera_move', 'Z184_WHIP', [])).toBe('Z184_WHIP')
  })

  it('刪別類的 id 刪不掉', async () => {
    const term = await addVocabularyTerm({
      user,
      kind: 'shot_size',
      value: 'Z184_TWO',
      label: `Z184 雙人 ${Date.now()}`,
    })
    created.push(term.id)

    // `kind` 讓刪除限定在呼叫端以為的那一類裡，複製錯的 id 不會刪到別類。
    await expect(
      deleteVocabularyTerm({ kind: 'camera_move', termId: term.id })
    ).rejects.toThrow('找不到這個選項')
  })
})
