import { describe, expect, it } from 'vitest'
import { durationCheck, formatSeconds, DURATION_TOLERANCE } from '@/lib/storyboard-view'
import { parseShotTable } from '@/lib/storyboard-apply'

/**
 * 分鏡工作台 (Z39/Z40/Z71).
 *
 * spec 12 對這一頁只寫了一句實作提醒：「不是影片剪輯器；鏡頭時長須校驗」。
 * 所以校驗是這裡最該釘住的東西——而它錯了**不會報錯**，只會給出一個看起來
 * 像數字的數字，然後在剪接的時候才發現多了四十秒。
 */

describe('鏡頭總長校驗', () => {
  it('沒有目標片長就說沒有，不要說「通過」', () => {
    /*
     * 這一條最重要。回 OK 的話，這個檢查會在最需要它的時候（還沒設目標的新
     * 集數）保持安靜——而那正是最容易寫過頭的時候。
     */
    const check = durationCheck([5, 5, 5], 0)
    expect(check.verdict).toBe('NO_TARGET')
    expect(check.totalSec).toBe(15)
    // 沒有目標就沒有「差多少」可言，不要給一個 15 讓人以為超出了 15 秒。
    expect(check.deltaSec).toBe(0)
  })

  it('落在容許範圍內算通過', () => {
    const check = durationCheck([60, 60, 30], 150)
    expect(check.verdict).toBe('OK')
    expect(check.totalSec).toBe(150)
    expect(check.deltaSec).toBe(0)
  })

  it('容許範圍是正負一成，而且把邊界算出來', () => {
    const check = durationCheck([150], 150)
    expect(check.lowSec).toBe(135)
    expect(check.highSec).toBe(165)
    expect(DURATION_TOLERANCE).toBe(0.1)
  })

  it('邊界上算通過，邊界外才警告', () => {
    expect(durationCheck([135], 150).verdict).toBe('OK')
    expect(durationCheck([134], 150).verdict).toBe('SHORT')
    expect(durationCheck([165], 150).verdict).toBe('OK')
    expect(durationCheck([166], 150).verdict).toBe('LONG')
  })

  it('超過與不足都要說差多少', () => {
    expect(durationCheck([200], 150).deltaSec).toBe(50)
    expect(durationCheck([100], 150).deltaSec).toBe(-50)
  })

  it('一個鏡頭都沒有的時候不是通過', () => {
    const check = durationCheck([], 150)
    expect(check.totalSec).toBe(0)
    expect(check.verdict).toBe('SHORT')
  })
})

describe('秒數寫成人看得懂的形式', () => {
  it('補零', () => {
    expect(formatSeconds(65)).toBe('1:05')
    expect(formatSeconds(0)).toBe('0:00')
    expect(formatSeconds(150)).toBe('2:30')
    expect(formatSeconds(600)).toBe('10:00')
  })

  it('負數不會變成 -1:-5 這種東西', () => {
    expect(formatSeconds(-30)).toBe('0:00')
  })
})

describe('AI 分鏡的輸出', () => {
  const one = {
    sceneCode: 'S01',
    durationSec: 6,
    shotSize: 'MCU',
    camera: 'DOLLY_IN',
    location: '灶房',
    timeOfDay: '日',
    action: '她的手停在鍋鏟上',
    dialogue: '這火候不對。',
    speaker: '沈知味',
    prompt: 'Chinese period kitchen, close on hands',
    negativePrompt: 'modern utensils',
  }

  it('讀得出乾淨的陣列', () => {
    const parsed = parseShotTable(JSON.stringify([one]))
    expect(parsed.rejected).toEqual([])
    expect(parsed.shots[0]).toEqual({
      sceneCode: 'S01',
      durationSec: 6,
      shotSize: 'MCU',
      camera: 'DOLLY_IN',
      location: '灶房',
      timeOfDay: '日',
      action: '她的手停在鍋鏟上',
      dialogue: '這火候不對。',
      speaker: '沈知味',
      prompt: 'Chinese period kitchen, close on hands',
      negativePrompt: 'modern utensils',
    })
  })

  it('包在物件裡或程式碼圍籬裡都讀得出來', () => {
    expect(parseShotTable(JSON.stringify({ shots: [one] })).shots).toHaveLength(1)
    expect(parseShotTable('```json\n' + JSON.stringify([one]) + '\n```').shots).toHaveLength(1)
  })

  it('秒數讀不出來就退回那一筆，不要當成 0', () => {
    /*
     * 這一欄是總長校驗的分母。讀成 0 會讓「加起來剛好 150 秒」變成算錯的結
     * 果，而算錯的結果跟算對的結果長得一模一樣。
     */
    for (const bad of [undefined, null, 0, -3, 'abc', {}]) {
      const parsed = parseShotTable(JSON.stringify([{ ...one, durationSec: bad }]))
      expect(parsed.shots).toHaveLength(0)
      expect(parsed.rejected[0]).toContain('秒數讀不出來')
    }
  })

  it('秒數寫成字串的數字還是收', () => {
    expect(parseShotTable(JSON.stringify([{ ...one, durationSec: '8' }])).shots[0]?.durationSec).toBe(8)
  })

  it('景別與運鏡認不得就落在預設值，不退回整筆', () => {
    /*
     * 跟秒數相反：景別猜錯改一個下拉就好，而退回整筆會把畫面描述與提示詞
     * 一起丟掉——那些才是這次請求真正買到的東西。
     */
    const parsed = parseShotTable(
      JSON.stringify([{ ...one, shotSize: '中景', camera: '推鏡' }])
    )
    expect(parsed.shots[0]?.shotSize).toBe('MS')
    expect(parsed.shots[0]?.camera).toBe('STATIC')
    expect(parsed.shots[0]?.action).toBe('她的手停在鍋鏟上')
  })

  it('小寫的列舉值照樣認得', () => {
    const parsed = parseShotTable(JSON.stringify([{ ...one, shotSize: 'cu', camera: 'pan' }]))
    expect(parsed.shots[0]?.shotSize).toBe('CU')
    expect(parsed.shots[0]?.camera).toBe('PAN')
  })

  it('沒有說話的人就填 null，不要填空字串', () => {
    const parsed = parseShotTable(JSON.stringify([{ ...one, speaker: '' }]))
    expect(parsed.shots[0]?.speaker).toBeNull()
  })

  it('整段不是 JSON 的時候回空清單加原因，不是丟例外', () => {
    const parsed = parseShotTable('鏡頭一：她的手停在鍋鏟上。')
    expect(parsed.shots).toEqual([])
    expect(parsed.rejected).toEqual(['整段讀不出 JSON'])
  })

  it('壞的那幾筆退回，好的那幾筆留下', () => {
    const parsed = parseShotTable(
      JSON.stringify([one, { ...one, durationSec: 'x' }, { ...one, durationSec: 4 }])
    )
    expect(parsed.shots).toHaveLength(2)
    expect(parsed.rejected).toHaveLength(1)
    expect(parsed.rejected[0]).toContain('第 2 筆')
  })
})
