import { beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 送進 AI 上下文的正文必須是純文字 (Z115).
 *
 * 小說編輯器傳的是它自己的原始內容，而那是 HTML。實測這部作品的 11 章：
 * 123,559 個字元裡 43,928 個是標籤——**35.6% 的 token 花在買 `<p>`**。
 *
 * 錢只是其中一半。另一半是標籤會干擾模型判斷段落：`<h2>` 跟 `<p>` 在模型
 * 眼裡就是內容，於是它得一邊讀故事一邊忽略排版。
 *
 * 這件事**編譯器攔不住**——`sourceText` 兩邊都是 string，塞 HTML 進去完全
 * 合法，而且跑起來也不會錯，只會安靜地貴 35% 又讀得比較差。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('AI 上下文的正文', () => {
  let buildContext: typeof import('@/lib/ai/jobs').buildContext

  beforeAll(async () => {
    buildContext = (await import('@/lib/ai/jobs')).buildContext
  })

  it('把編輯器送來的 HTML 轉成純文字', async () => {
    const context = await buildContext({
      projectId: null,
      episodeId: null,
      novelEpisodeId: null,
      sourceText: '<h2>第一章</h2><p>沈知味睜開眼。</p><p>灶是冷的。</p>',
      userInstruction: '',
      includeWorld: false,
      includeCharacters: false,
    })

    expect(context.sourceText).toBeDefined()
    // 一個標籤都不准留下。
    expect(context.sourceText).not.toMatch(/<[^>]+>/)
    expect(context.sourceText).toContain('沈知味睜開眼。')
    expect(context.sourceText).toContain('灶是冷的。')
  })

  /**
   * 段落界線要留著。
   *
   * `<p>a</p><p>b</p>` 如果變成 "ab"，模型會把兩段當成一句——那是用省 token
   * 換掉文意，比留著標籤更糟。
   */
  it('段落不會被黏成一句', async () => {
    const context = await buildContext({
      projectId: null,
      episodeId: null,
      novelEpisodeId: null,
      sourceText: '<p>第一段。</p><p>第二段。</p>',
      userInstruction: '',
      includeWorld: false,
      includeCharacters: false,
    })

    expect(context.sourceText).not.toContain('第一段。第二段。')
    expect(context.sourceText).toMatch(/第一段。\s+第二段。/)
  })

  /** 已經是純文字的就原樣過去——這支要能重複套用而不壞。 */
  it('對純文字是等冪的', async () => {
    const plain = '沈知味睜開眼。\n\n灶是冷的。'
    const context = await buildContext({
      projectId: null,
      episodeId: null,
      novelEpisodeId: null,
      sourceText: plain,
      userInstruction: '',
      includeWorld: false,
      includeCharacters: false,
    })

    expect(context.sourceText).toBe(plain)
  })

  /**
   * 估價與實際送出必須看到同一份文字。
   *
   * 兩個數字是並排顯示給人看的（成本確認那一頁）。如果估的時候算進標籤、
   * 送的時候不算，那個差距沒有人解釋得出來——而這正是為什麼修在
   * `buildContext()` 而不是修在小說編輯器裡。
   */
  it('估價與送出走同一個入口', async () => {
    const html = '<p>一樣的內容。</p>'

    const shared = {
      projectId: null,
      episodeId: null,
      novelEpisodeId: null,
      userInstruction: '',
      includeWorld: false,
      includeCharacters: false,
    } as const

    const a = await buildContext({ ...shared, sourceText: html })
    const b = await buildContext({ ...shared, sourceText: html })

    expect(a.sourceText).toBe(b.sourceText)
    expect(a.sourceText).toBe('一樣的內容。')
  })
})
