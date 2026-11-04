import { describe, expect, it } from 'vitest'
import { splitForSpeech } from '@/lib/speech'

/**
 * 朗讀怎麼切段（Z朗讀）。
 *
 * 這組測試的存在理由是一個實測數字：Chrome 唸 70 個中文字要 18.3 秒，
 * 大約每秒 3.9 字。而瀏覽器大約 15 秒就會把單一 utterance 砍掉。
 *
 * 所以「一段最多幾個字」不是美感問題，是「會不會讀到一半自己停掉」。
 * 40 字 ≈ 10 秒，留了餘裕。
 */

/** 實測：Chrome 每秒唸大約 3.9 個中文字。 */
const CHARS_PER_SECOND = 3.9
/** 瀏覽器砍掉單一 utterance 的時間。 */
const CUTOFF_SECONDS = 15

describe('splitForSpeech', () => {
  it('短段落維持一段一句，不會被切碎', () => {
    const chunks = splitForSpeech(['「三文錢。」她說。', '他沒接話。'])
    expect(chunks.map((c) => c.text)).toEqual(['「三文錢。」她說。', '他沒接話。'])
  })

  it('每一段都記得自己是第幾個段落', () => {
    const chunks = splitForSpeech(['第一段。', '第二段。', '第三段。'])
    expect(chunks.map((c) => c.paragraph)).toEqual([0, 1, 2])
  })

  it('長段落切成多段，但都指回同一個段落', () => {
    // 這是舊版的漏洞：highlight 用的是 chunk 的序號，
    // 只要有一個段落被切成兩塊，之後整章的 highlight 都會錯位。
    const long = '沈知味把灶上的火壓小了一些，鍋裡的湯還在翻。'.repeat(6)
    const chunks = splitForSpeech(['短的。', long, '也是短的。'])

    expect(chunks.filter((c) => c.paragraph === 1).length).toBeGreaterThan(1)
    expect(chunks[0]?.paragraph).toBe(0)
    expect(chunks.at(-1)?.paragraph).toBe(2)

    // 段落序號只會往前，不會跳號。
    const seen = chunks.map((c) => c.paragraph)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('沒有任何一段長到會被瀏覽器砍掉', () => {
    const paragraphs = [
      '「三文錢。」',
      '沈知味把灶上的火壓小了一些，鍋裡的湯還在翻，白氣貼著樑走，一直走到門口才散。',
      '他沒接話。',
      // 一整句沒有標點的極端情況。
      '阿'.repeat(300),
    ]

    for (const chunk of splitForSpeech(paragraphs)) {
      const seconds = chunk.text.length / CHARS_PER_SECOND
      expect(seconds, `「${chunk.text.slice(0, 20)}…」要唸 ${seconds.toFixed(1)} 秒`).toBeLessThan(
        CUTOFF_SECONDS
      )
    }
  })

  it('一句沒有標點的長句也會被切開，不會變成一段 80 秒的話', () => {
    const chunks = splitForSpeech(['阿'.repeat(300)])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.paragraph === 0)).toBe(true)
    // 切開但不掉字。
    expect(chunks.map((c) => c.text).join('')).toBe('阿'.repeat(300))
  })

  it('空白段落不會產生空的 utterance', () => {
    const chunks = splitForSpeech(['有字。', '   ', '', '也有字。'])
    expect(chunks.map((c) => c.text)).toEqual(['有字。', '也有字。'])
  })

  /* ---- 原本放在 novel-export.test.ts 的幾條，搬過來並改成新的形狀 ---- */

  it('切在句末標點後面，而且把標點留著', () => {
    // 標點是合成器停頓的依據，切掉就變成一口氣唸完。
    const out = splitForSpeech(['她猛地睜開眼。映入眼簾的不是夜市。'], 10)
    expect(out.map((c) => c.text)).toEqual(['她猛地睜開眼。', '映入眼簾的不是夜市。'])
  })

  it('短句會合併到上限為止，不是一句一段', () => {
    // 一句一段會讓合成器在每個句號都停頓一次，聽起來像在報帳。
    const out = splitForSpeech(['一。二。三。'], 100)
    expect(out.map((c) => c.text)).toEqual(['一。二。三。'])
  })

  it('問號與驚嘆號也算句末', () => {
    const out = splitForSpeech(['三百文？破車！'], 5)
    expect(out.map((c) => c.text)).toEqual(['三百文？', '破車！'])
  })

  it('沒有標點的長段落真的會被切開', () => {
    /*
     * 這一條以前只驗「字沒有掉」——而舊的程式把 500 字原封不動丟給
     * 合成器，照樣通過。一段 500 字要唸兩分多鐘，正是瀏覽器會中途
     * 停掉的那種長度，所以這裡要驗的是「真的切開了」。
     */
    const long = '字'.repeat(500)
    const out = splitForSpeech([long], 180)

    expect(out.length).toBeGreaterThan(1)
    expect(out.every((c) => c.text.length <= 180)).toBe(true)
    expect(out.map((c) => c.text).join('')).toBe(long)
  })

  it('不掉字：切出來接回去就是原文', () => {
    const paragraphs = [
      '「三文錢。」她說。',
      '鍋裡的湯還在翻，白氣貼著樑走，一直走到門口才散；他沒接話，只是把碗推了回來。',
    ]
    const chunks = splitForSpeech(paragraphs)

    for (const [index, paragraph] of paragraphs.entries()) {
      const rebuilt = chunks
        .filter((c) => c.paragraph === index)
        .map((c) => c.text)
        .join('')
      expect(rebuilt).toBe(paragraph)
    }
  })
})
