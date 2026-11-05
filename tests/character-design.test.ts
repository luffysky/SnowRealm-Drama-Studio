import { describe, expect, it } from 'vitest'
import { mergeDesign, parseCharacterDesign } from '@/lib/character-design'

/**
 * 角色設計與定妝 (Z70).
 *
 * `CHARACTER_DESIGN` 的 prompt、定價、佇列一直都在，介面上沒有地方按得到
 * ——`npm run check:ai` 量出來的七個之一。
 *
 * 這裡釘兩件**錯了也不會報錯**的事：
 *
 *  1. 解析失敗時不能回一個四格空白的「成功」——採用會把四個空字串寫進去，
 *     看起來就像它正常跑完了。
 *  2. 不能蓋掉作者自己寫的。角色設定沒有版本歷史，蓋掉就是真的沒了，而且
 *     畫面上還是有字，看不出來被換過。
 */

const FULL = {
  appearance: '粗布短打，袖口捲起',
  visualPrompt: 'Chinese period drama, young female cook',
  negativePrompt: 'modern clothing',
  voiceNote: '偏低、乾脆',
}

describe('解析模型回來的角色設定', () => {
  it('讀得出乾淨的 JSON', () => {
    expect(parseCharacterDesign(JSON.stringify(FULL))).toEqual(FULL)
  })

  it('包在程式碼圍籬裡也讀得出來', () => {
    const wrapped = '好的，以下是設定：\n```json\n' + JSON.stringify(FULL) + '\n```\n希望有幫助。'
    expect(parseCharacterDesign(wrapped)).toEqual(FULL)
  })

  it('只填了一部分也算數', () => {
    const partial = parseCharacterDesign('{"visualPrompt":"a cook","appearance":""}')
    expect(partial).not.toBeNull()
    expect(partial!.visualPrompt).toBe('a cook')
    expect(partial!.appearance).toBe('')
  })

  /**
   * **四格全空不是成功。**
   *
   * 回一個空白的結果，會讓採用把四個空字串寫進角色，而任務會被標成已採用
   * ——看起來就像它正常跑完了，只是角色沒變。
   */
  it('四格全空算失敗', () => {
    expect(parseCharacterDesign('{"appearance":"","visualPrompt":"  "}')).toBeNull()
  })

  it('不是 JSON、是陣列、是空的，都算失敗', () => {
    expect(parseCharacterDesign('我覺得這個角色應該穿粗布衣服。')).toBeNull()
    expect(parseCharacterDesign('[{"appearance":"x"}]')).toBeNull()
    expect(parseCharacterDesign('')).toBeNull()
    expect(parseCharacterDesign('{壞掉的 json')).toBeNull()
  })

  it('非字串的欄位當成沒給，不要硬塞進去', () => {
    const parsed = parseCharacterDesign('{"appearance":123,"visualPrompt":"a cook"}')
    expect(parsed!.appearance).toBe('')
    expect(parsed!.visualPrompt).toBe('a cook')
  })
})

describe('寫回角色時不蓋掉作者寫的', () => {
  const blank = { appearance: '', visualPrompt: '', negativePrompt: '', voiceNote: '' }

  it('全空的角色四欄都填', () => {
    const { patch, filled, kept } = mergeDesign(blank, FULL)

    expect(filled).toHaveLength(4)
    expect(kept).toHaveLength(0)
    expect(patch.appearance).toBe(FULL.appearance)
  })

  /**
   * 這一條是整個功能最重要的保證。
   *
   * 錯起來是**安靜地覆蓋**：跑一次看不出來，因為欄位裡還是有字——只是換成
   * 了別人寫的。
   */
  it('已經寫過的欄位原封不動', () => {
    const written = { ...blank, appearance: '作者親手寫的外型' }
    const { patch, filled, kept } = mergeDesign(written, FULL)

    expect(patch.appearance).toBeUndefined()
    expect(kept).toContain('外型 / 服裝 / 髮型')
    expect(filled).not.toContain('外型 / 服裝 / 髮型')
    // 其他三欄還是要填。
    expect(patch.visualPrompt).toBe(FULL.visualPrompt)
  })

  it('只有空白字元的欄位算空的', () => {
    const { patch } = mergeDesign({ ...blank, appearance: '   ' }, FULL)
    expect(patch.appearance).toBe(FULL.appearance)
  })

  it('模型沒給的欄位不會被清空', () => {
    const written = { ...blank, voiceNote: '原本的配音備註' }
    const { patch, kept } = mergeDesign(written, { ...FULL, voiceNote: '' })

    expect(patch.voiceNote).toBeUndefined()
    // 沒給就不是「保留」，是根本沒提到——不該出現在保留清單裡。
    expect(kept).not.toContain('配音備註')
  })

  it('每一欄都寫過的話，什麼都不改', () => {
    const { patch, filled, kept } = mergeDesign(
      { appearance: 'a', visualPrompt: 'b', negativePrompt: 'c', voiceNote: 'd' },
      FULL
    )

    expect(Object.keys(patch)).toHaveLength(0)
    expect(filled).toHaveLength(0)
    expect(kept).toHaveLength(4)
  })
})
