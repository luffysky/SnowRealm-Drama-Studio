import { describe, expect, it } from 'vitest'
import { buildUserMessage, renderContext } from '@/lib/ai/prompts'
import type { AiContext } from '@/lib/ai/types'

/**
 * 觀眾那一趟拿不到隱藏設定（Z201）。
 *
 * 這是雙視角審核的**整個主張**。在一個複製貼上的工具裡，「不得讓觀眾階段接觸隱
 * 藏設定」只能是一句請求——同一個對話框裡模型早就讀過答案了，叫它「假裝不知道」
 * 是禮貌，不是保證。
 *
 * 在這裡它可以是結構上做不到的，而「可以是」跟「是」之間差的就是這一支測試。
 *
 * 兩道鎖：
 *
 * 1. 組 context 的那一端不放（`auditEpisode` 的 context 物件裡沒有那一欄）。
 * 2. `renderContext` 在 `auditPass === 'audience'` 時遇到 `secretNotes`
 *    **直接丟例外**。
 *
 * 第一道是習慣，第二道才是保證：下一個人多傳一個欄位進來，外洩會悄悄發生，而
 * 產出看起來完全合理——模型知道答案，所以它說這一集沒有問題。
 */

const SECRET = '梅花印其實是沈家與許家的共營商契，第 28 集才揭曉。'

describe('雙視角的隔離（Z201）', () => {
  it('觀眾視角拿到隱藏設定時直接丟例外，不是把它吃掉', () => {
    const context: AiContext = {
      auditPass: 'audience',
      sourceText: '沈知味推開門。',
      secretNotes: SECRET,
    }

    expect(() => renderContext(context)).toThrow(/觀眾視角不可以拿到隱藏設定/)
  })

  it('丟例外而不是靜靜略過——這兩件事在畫面上長得一樣', () => {
    /*
     * 如果改成「略過」，下面這一段會安靜地通過，而產出是一份模型知道答案的
     * 報告。這一條就是在擋那個「比較溫和」的修法。
     */
    let threw = false
    try {
      renderContext({ auditPass: 'audience', secretNotes: SECRET })
    } catch {
      threw = true
    }
    expect(threw, '觀眾視角帶著隱藏設定時必須丟').toBe(true)
  })

  it('編劇視角拿得到，而且真的被寫進提示詞', () => {
    const text = renderContext({
      auditPass: 'writer',
      sourceText: '沈知味推開門。',
      secretNotes: SECRET,
      audienceFindings: '1. 梅花刻痕是什麼？',
    })

    expect(text).toContain(SECRET)
    expect(text).toContain('只有編劇視角看得到')
    expect(text).toContain('梅花刻痕是什麼')
  })

  it('沒有指定視角時也不會意外漏出去', () => {
    /*
     * `auditPass` 沒給的時候是其他任務（改稿、生分鏡），那些本來就不該拿到隱
     * 藏設定——但它們也不會傳。這裡驗的是「沒傳就不會出現」，不是「沒傳也擋」。
     */
    const text = renderContext({ sourceText: '沈知味推開門。' })
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('隱藏設定')
  })

  it('觀眾視角的完整訊息裡一個字都沒有', () => {
    const text = buildUserMessage('NOVEL_REVIEW', {
      projectTitle: '一灶見山河',
      episodeNumber: 7,
      auditPass: 'audience',
      priorSummary: '第 1 集：沈知味用三文錢起家。',
      sourceText: '沈知味推開門，灶上的火還沒熄。',
    })

    expect(text).toContain('此前已公開的劇情')
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('隱藏設定')
  })
})
