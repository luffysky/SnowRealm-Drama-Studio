import { describe, expect, it } from 'vitest'
import { countText, countRichTextChars } from '@/lib/utils'

/**
 * 「字數」不是一個數字（Z123）。
 *
 * 實測這部戲的正文，標點佔「含標點字數」的 20.5%——「不夠。」五個字元裡
 * 兩個是標點。對 4,000 字的目標來說，用哪一種算法差得出一整集。
 */
describe('countText', () => {
  it('四種算法各自算各自的', () => {
    const counts = countText('<p>「不夠。」</p>')
    // 「 不 夠 。 」 = 5 個字元，其中 「 。 」 三個是標點
    expect(counts.all).toBe(5)
    expect(counts.withPunctuation).toBe(5)
    expect(counts.letters).toBe(2)
    expect(counts.punctuation).toBe(3)
    expect(counts.spaces).toBe(0)
  })

  it('空白只算在「全部」裡', () => {
    const counts = countText('<p>一 二</p><p>三</p>')
    expect(counts.letters).toBe(3)
    expect(counts.spaces).toBeGreaterThan(0)
    expect(counts.all).toBe(counts.withPunctuation + counts.spaces)
  })

  it('含標點 = 純文字 ＋ 標點', () => {
    const counts = countText('<p>沈知味說：「三文錢。」</p>')
    expect(counts.withPunctuation).toBe(counts.letters + counts.punctuation)
  })

  it('跟既有的 countRichTextChars 對得上', () => {
    /*
     * 目前所有的目標、進度、集數統計用的都是 countRichTextChars。
     * 它等於「不含空白、含標點」——兩者對不上的話，頁尾那行字就會跟
     * 進度條各說各話。
     */
    for (const html of [
      '<p>「不夠。」</p>',
      '<p>沈知味把灶上的火壓小了一些。</p><p>「三文錢。」</p>',
      '<h2>第001集</h2><p>正文……</p>',
    ]) {
      expect(countText(html).withPunctuation, html).toBe(countRichTextChars(html))
    }
  })

  it('HTML 標籤不算字', () => {
    expect(countText('<p><strong>一</strong></p>').letters).toBe(1)
  })

  it('空的就是零', () => {
    const counts = countText('')
    expect(counts).toEqual({ all: 0, withPunctuation: 0, letters: 0, punctuation: 0, spaces: 0 })
  })
})
