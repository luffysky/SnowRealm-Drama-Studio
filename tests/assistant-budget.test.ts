import { describe, expect, it } from 'vitest'
import { chapterForModel, newReadBudget } from '@/lib/assistant/run'

/**
 * 助理讀正文的額度 (Z101).
 *
 * 在這之前 `read_chapter` 回傳**整集的正文，沒有任何節制**——這一輪花多少
 * 錢是模型決定的，不是我們決定的。
 *
 * 真正的乘數不是字數是回合：每一個工具回合都會把整段對話重送一次，所以
 * 第一回合讀進來的字，在後面五個回合都會再付一次。實測那筆 `/outline`
 * 三集 17,724 字收 $0.42，而單讀一次大約只要 $0.07——差距全在重送。
 *
 * 這種東西的錯法是「看起來有在限制、實際上沒有」，而那在真的跑一輪對話時
 * 完全看不出來：帳單要到月底才說話。所以額度的決定抽成純函式，在這裡釘住。
 */

const PROSE = '沈知味睜開眼。'.repeat(200) // 1,400 字

describe('助理的讀取額度', () => {
  it('在額度內就給全文', () => {
    const budget = newReadBudget(10_000)
    const out = chapterForModel({
      heading: '【章節 id=x】第一章',
      body: PROSE,
      summary: '她醒了。',
      budget,
    })

    expect(out).toContain(PROSE)
    expect(budget.spent).toBe(PROSE.length)
    expect(budget.remaining).toBe(10_000 - PROSE.length)
    expect(budget.trimmed).toBe(0)
  })

  /**
   * **安靜地截斷是這裡最危險的做法。**
   *
   * 模型若以為自己讀完了整章，它會很有信心地總結一篇只看了四分之一的東西，
   * 而那個錯誤沒有任何跡象——輸出看起來一樣像樣。
   */
  it('超過額度時明講這不是全文', () => {
    const budget = newReadBudget(100)
    const out = chapterForModel({
      heading: '【章節 id=x】第一章',
      body: PROSE,
      summary: '她醒了。',
      budget,
      excerptChars: 50,
    })

    expect(out).toContain('沒有完整給你')
    expect(out).toContain(`全章 ${PROSE.length} 字`)
    expect(out).toContain('摘要：她醒了。')
    expect(out).not.toContain(PROSE)
    expect(budget.trimmed).toBe(1)
  })

  it('沒有摘要時只給開頭，而且不假裝有摘要', () => {
    const budget = newReadBudget(100)
    const out = chapterForModel({
      heading: '【章節 id=x】第一章',
      body: PROSE,
      summary: '   ',
      budget,
      excerptChars: 50,
    })

    expect(out).not.toContain('摘要：')
    expect(out).toContain('開頭：')
    expect(out).toContain('沒有完整給你')
  })

  /**
   * 額度是**整輪共用**的。
   *
   * 每次呼叫各自一份的話，模型只要多叫幾次就繞過去了——而這個上限存在的
   * 理由正是「這一輪花多少錢不該由模型決定」。
   */
  it('同一份額度會被連續的讀取吃掉', () => {
    const budget = newReadBudget(PROSE.length + 10)

    const first = chapterForModel({
      heading: 'A',
      body: PROSE,
      summary: '',
      budget,
    })
    const second = chapterForModel({
      heading: 'B',
      body: PROSE,
      summary: '',
      budget,
    })

    expect(first).toContain(PROSE)
    expect(second).toContain('沒有完整給你')
    expect(budget.trimmed).toBe(1)
  })

  it('額度用完之後，後面每一章都是摘要', () => {
    const budget = newReadBudget(10)

    for (let i = 0; i < 3; i += 1) {
      const out = chapterForModel({ heading: `第${i}章`, body: PROSE, summary: '', budget })
      expect(out).toContain('沒有完整給你')
    }

    expect(budget.trimmed).toBe(3)
    expect(budget.remaining).toBe(0)
  })

  /**
   * 預設額度要真的擋得住這部作品。
   *
   * 一集約 7,400 字，整本 120 集就是 89 萬字。預設額度必須明顯小於「一次
   * 全讀」，否則這個上限只是裝飾。
   */
  it('預設額度擋得住整本全讀', () => {
    const budget = newReadBudget()
    const wholeBook = 120 * 7_400

    expect(budget.remaining).toBeLessThan(wholeBook / 10)
    expect(budget.remaining).toBeGreaterThan(7_400 * 2)
  })
})
