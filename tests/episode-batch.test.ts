import { describe, expect, it } from 'vitest'
import { episodeTitleFor, planEpisodeBatch } from '@/lib/episode-batch-view'

/**
 * 批次建立集數 (Z66).
 *
 * `episodeBatchSchema` 寫好很久、零個呼叫端——`check:dead` 掃出來的那批之一。
 *
 * 這裡釘的是**錯了也不會報錯**的那兩件：跳過已存在的集數算得對不對，以及
 * 標題樣板空白的時候不要自己編一個標題出來。
 */

describe('這一批會建哪幾集', () => {
  it('沒有重複的時候整段都建', () => {
    const plan = planEpisodeBatch({ from: 1, to: 5, existing: [], skipExisting: true })
    expect(plan.create).toEqual([1, 2, 3, 4, 5])
    expect(plan.skipped).toEqual([])
  })

  it('已經存在的跳過，其餘照建', () => {
    const plan = planEpisodeBatch({ from: 1, to: 5, existing: [2, 4], skipExisting: true })
    expect(plan.create).toEqual([1, 3, 5])
    expect(plan.skipped).toEqual([2, 4])
  })

  it('整段都已存在就什麼都不建，而且不當成錯誤', () => {
    const plan = planEpisodeBatch({ from: 1, to: 3, existing: [1, 2, 3], skipExisting: true })
    expect(plan.create).toEqual([])
    expect(plan.skipped).toEqual([1, 2, 3])
  })

  it('不跳過又撞號就事前擋下來，而且說是哪幾集', () => {
    /*
     * 不擋的話會走到 insert，`unique(project_id, number)` 把整批回滾——結果是
     * 「一集都沒建」加上一句資料庫的錯誤訊息。事前說「第 2、4 集已經存在」
     * 才知道該怎麼辦。
     */
    expect(() =>
      planEpisodeBatch({ from: 1, to: 5, existing: [2, 4], skipExisting: false })
    ).toThrow(/2、4/)
  })

  it('單集範圍也成立', () => {
    expect(planEpisodeBatch({ from: 7, to: 7, existing: [], skipExisting: true }).create).toEqual([
      7,
    ])
  })
})

describe('標題樣板', () => {
  it('樣板空白就回空字串，不要自己編一個標題', () => {
    /*
     * 自動補「第 7 集」看起來貼心，實際上是把「這一集還沒命名」這個狀態消滅
     * 掉——之後再也答不出「哪幾集還沒取標題」。大綱板上那個「只看未寫」就是
     * 靠空值在運作的。
     */
    expect(episodeTitleFor('', 7)).toBe('')
    expect(episodeTitleFor('   ', 7)).toBe('')
  })

  it('{n} 換成集號', () => {
    expect(episodeTitleFor('第 {n} 集', 7)).toBe('第 7 集')
  })

  it('{nnn} 補零到三位，跟畫面上的 EP007 一致', () => {
    expect(episodeTitleFor('EP{nnn}', 7)).toBe('EP007')
    expect(episodeTitleFor('EP{nnn}', 113)).toBe('EP113')
  })

  it('兩種可以混用，而且 {nnn} 不會被 {n} 吃掉', () => {
    /*
     * 先換 `{nnn}` 再換 `{n}`。順序反過來的話，`{nnn}` 會先被當成 `{n}` 加上
     * 兩個字母 n，變成「7nn」——而那是個看起來只是打錯字的錯。
     */
    expect(episodeTitleFor('{nnn}｜第{n}集', 7)).toBe('007｜第7集')
  })

  it('沒有佔位符就每一集都同名，照樣板照抄', () => {
    expect(episodeTitleFor('待定', 7)).toBe('待定')
  })

  it('超長的樣板切到 120 字，不要讓資料庫擋下整批', () => {
    expect(episodeTitleFor('長'.repeat(300), 1)).toHaveLength(120)
  })
})
