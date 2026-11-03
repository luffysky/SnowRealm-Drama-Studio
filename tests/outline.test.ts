import { describe, expect, it } from 'vitest'
import { diffOutline, parseOutline } from '@/lib/outline'

/**
 * 分集大綱 parsing (`docs/OUTLINE.md`).
 *
 * The model is asked for a fixed shape and mostly complies. These pin the
 * deviations that actually occur — full-width colons, missing leading zeros,
 * a stray 「第N集」 in the title — because a generation that cost money should
 * not be discarded over punctuation.
 */

describe('parseOutline', () => {
  it('reads the documented shape', () => {
    const { entries, unparsed } = parseOutline(`
### EP001
標題：三文錢的生意
一句話：沈知味醒來發現自己欠了一屁股債。
大綱：她被餿水潑醒，發現穿到了欠債的攤販身上。
討債的上門，她用一張嘴換到三天期限。

### EP002
標題：第一鍋
一句話：她決定靠一口舊灶翻身。
大綱：擦灶、備料、開張。
`)

    expect(unparsed).toEqual([])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      number: 1,
      title: '三文錢的生意',
      logline: '沈知味醒來發現自己欠了一屁股債。',
    })
    // 大綱 runs to the end of the block, including the line after the colon.
    expect(entries[0]!.synopsis).toContain('她用一張嘴換到三天期限')
    expect(entries[1]!.number).toBe(2)
  })

  it('accepts half-width colons, bold, and 第N集 headings', () => {
    const { entries } = parseOutline(`
## 第12集
**標題**: 夜市風波
一句話: 對手砸了她的攤子。
大綱: 衝突升級。
`)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ number: 12, title: '夜市風波' })
  })

  it('strips an episode number the model repeats in the title', () => {
    // Otherwise every row reads 「EP012 第12集 夜市風波」.
    const { entries } = parseOutline(`### EP012
標題：第12集：夜市風波
一句話：對手砸了她的攤子。`)

    expect(entries[0]!.title).toBe('夜市風波')
  })

  it('reports a block it could not read instead of dropping it silently', () => {
    const { entries, unparsed } = parseOutline(`
### EP003
### EP004
標題：有內容
`)

    expect(entries).toHaveLength(1)
    expect(unparsed).toEqual(['EP003'])
  })

  it('keeps prose written without field labels', () => {
    const { entries } = parseOutline(`### EP005
她在碼頭等了一整夜，天亮前才動身。`)

    expect(entries[0]!.synopsis).toBe('她在碼頭等了一整夜，天亮前才動身。')
  })

  it('returns nothing for text with no episode headings', () => {
    expect(parseOutline('這是一段沒有任何集數標記的文字。').entries).toEqual([])
  })
})

describe('diffOutline', () => {
  const existing = [
    { id: 'a', number: 1, title: '舊標題', logline: '舊的一句話', synopsis: '舊大綱' },
    { id: 'b', number: 2, title: '', logline: '', synopsis: '' },
  ]

  it('lists only the fields that actually change', () => {
    const diff = diffOutline(
      [{ number: 1, title: '新標題', logline: '舊的一句話', synopsis: '新大綱' }],
      existing
    )

    expect(diff).toHaveLength(1)
    expect(diff[0]!.changes.map((c) => c.field)).toEqual(['title', 'synopsis'])
    expect(diff[0]!.episodeId).toBe('a')
  })

  it('never clears existing text with a blank the model did not write', () => {
    /*
     * The one unrecoverable mistake this feature could make. A missing field
     * means "the model did not produce one", never "delete what is there".
     */
    const diff = diffOutline([{ number: 1, title: '', logline: '', synopsis: '' }], existing)

    expect(diff).toEqual([])
  })

  it('ignores episodes that do not exist', () => {
    const diff = diffOutline([{ number: 99, title: 'x', logline: '', synopsis: '' }], existing)

    expect(diff).toEqual([])
  })

  it('treats filling an empty episode as a change', () => {
    const diff = diffOutline([{ number: 2, title: '新的', logline: '', synopsis: '' }], existing)

    expect(diff[0]!.changes).toEqual([{ field: 'title', before: '', after: '新的' }])
  })
})
