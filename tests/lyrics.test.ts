import { describe, expect, it } from 'vitest'
import {
  clearStamp,
  formatLrcTime,
  isLrc,
  lineAt,
  parseLrc,
  parseLyrics,
  parsePlain,
  stampLine,
  stampProgress,
  toLrc,
  type LyricLine,
} from '@/lib/lyrics'

/**
 * 歌詞跟著歌走（Z125）。
 *
 * 時間對不對是那種「歌放到一半才發現」的錯。能用測試問的就不要用耳朵問。
 */

describe('isLrc', () => {
  it('有時間碼開頭的就是 LRC', () => {
    expect(isLrc('[00:12.34]一句詞')).toBe(true)
    expect(isLrc('[ti:標題]\n[00:01.00]詞')).toBe(true)
  })

  it('只有純文字就不是', () => {
    expect(isLrc('第一句\n第二句')).toBe(false)
    // 中括號不等於時間碼
    expect(isLrc('[副歌]\n唱什麼')).toBe(false)
  })
})

describe('parseLrc 的時間', () => {
  it('認得 [mm:ss]、[mm:ss.xx]、[mm:ss.xxx]', () => {
    const { lines } = parseLrc('[00:05]甲\n[00:05.5]乙\n[00:05.50]丙\n[00:05.500]丁')
    expect(lines.map((l) => l.timeMs)).toEqual([5000, 5500, 5500, 5500])
  })

  it('兩位小數是百分之一秒，不是千分之一', () => {
    // [00:01.07] 是 1.07 秒，不是 1.007 秒——這一位搞錯，整首會慢慢飄掉。
    const { lines } = parseLrc('[00:01.07]詞')
    expect(lines[0]!.timeMs).toBe(1070)
  })

  it('分鐘可以超過 59', () => {
    const { lines } = parseLrc('[100:00.00]很長的歌')
    expect(lines[0]!.timeMs).toBe(100 * 60_000)
  })

  it('一行多個時間碼會展開成多行——副歌只寫一次', () => {
    const { lines } = parseLrc('[00:42.10][02:15.30]副歌')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.text)).toEqual(['副歌', '副歌'])
    expect(lines.map((l) => l.timeMs)).toEqual([42_100, 135_300])
  })

  it('句子中間的中括號是歌詞，不是提示', () => {
    const { lines } = parseLrc('[00:10.00]他說[01:00.00]然後走了')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toBe('他說[01:00.00]然後走了')
  })
})

describe('parseLrc 的標頭', () => {
  it('讀得出 ti / ar / al / by', () => {
    const { meta } = parseLrc('[ti:三文錢]\n[ar:沈知味]\n[al:一灶見山河]\n[by:暖寶]\n[00:01.00]詞')
    expect(meta).toMatchObject({
      title: '三文錢',
      artist: '沈知味',
      album: '一灶見山河',
      by: '暖寶',
    })
  })

  it('標頭不會變成歌詞', () => {
    const { lines } = parseLrc('[ti:標題]\n[00:01.00]真正的第一句')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toBe('真正的第一句')
  })

  it('正的 offset 讓歌詞提早出現', () => {
    // LRC 的慣例：+ 是把時間往前提，所以有效時間是 time - offset。
    const { lines } = parseLrc('[offset:+500]\n[00:10.00]詞')
    expect(lines[0]!.timeMs).toBe(9500)
  })

  it('負的 offset 讓歌詞延後', () => {
    const { lines } = parseLrc('[offset:-500]\n[00:10.00]詞')
    expect(lines[0]!.timeMs).toBe(10_500)
  })

  it('offset 不會把時間推到負數', () => {
    const { lines } = parseLrc('[offset:+5000]\n[00:01.00]詞')
    expect(lines[0]!.timeMs).toBe(0)
  })
})

describe('parseLrc 的容錯', () => {
  it('壞掉的一行照樣顯示，只是沒有時間', () => {
    const { lines, timed } = parseLrc('[00:01.00]好的\n這行沒有時間碼')
    expect(timed).toBe(true)
    expect(lines.map((l) => l.text)).toContain('這行沒有時間碼')
    expect(lines.find((l) => l.text === '這行沒有時間碼')!.timeMs).toBeNull()
  })

  it('沒有時間的行排到最後，不會蓋住開頭', () => {
    const { lines } = parseLrc('沒時間的\n[00:05.00]第二\n[00:01.00]第一')
    expect(lines.map((l) => l.text)).toEqual(['第一', '第二', '沒時間的'])
  })

  it('空行不會變成空的歌詞', () => {
    const { lines } = parseLrc('[00:01.00]甲\n\n\n[00:02.00]乙')
    expect(lines).toHaveLength(2)
  })

  it('有時間碼但沒有字的行會留著——那是間奏', () => {
    const { lines } = parseLrc('[00:01.00]甲\n[00:20.00]\n[00:30.00]乙')
    expect(lines).toHaveLength(3)
    expect(lines[1]!.text).toBe('')
    expect(lines[1]!.timeMs).toBe(20_000)
  })

  it('CRLF 的檔案也讀得進來', () => {
    const { lines } = parseLrc('[00:01.00]甲\r\n[00:02.00]乙')
    expect(lines.map((l) => l.text)).toEqual(['甲', '乙'])
  })

  it('Enhanced LRC 的逐字標記會被拿掉，字留著', () => {
    const { lines } = parseLrc('[00:01.00]<00:01.00>三<00:01.50>文<00:02.00>錢')
    expect(lines[0]!.text).toBe('三文錢')
  })

  it('空字串不會爆', () => {
    expect(parseLrc('')).toEqual({ lines: [], meta: {}, timed: false })
  })
})

describe('parsePlain / parseLyrics', () => {
  it('純文字就是一行一句，沒有時間', () => {
    const { lines, timed } = parsePlain('第一句\n  第二句  \n\n第三句')
    expect(timed).toBe(false)
    expect(lines.map((l) => l.text)).toEqual(['第一句', '第二句', '第三句'])
    expect(lines.every((l) => l.timeMs === null)).toBe(true)
  })

  it('parseLyrics 自己判斷是哪一種', () => {
    expect(parseLyrics('[00:01.00]詞').timed).toBe(true)
    expect(parseLyrics('詞').timed).toBe(false)
  })
})

describe('formatLrcTime 與 toLrc', () => {
  it('寫成 mm:ss.xx', () => {
    expect(formatLrcTime(0)).toBe('00:00.00')
    expect(formatLrcTime(1070)).toBe('00:01.07')
    expect(formatLrcTime(135_300)).toBe('02:15.30')
  })

  it('負數不會寫出 -00:01', () => {
    expect(formatLrcTime(-500)).toBe('00:00.00')
  })

  it('來回一趟時間不會跑掉', () => {
    const source = '[ti:三文錢]\n[00:01.07]甲\n[02:15.30]乙\n沒時間的'
    const once = parseLrc(source)
    const twice = parseLrc(toLrc(once))

    expect(twice.lines.map((l) => [l.timeMs, l.text])).toEqual(
      once.lines.map((l) => [l.timeMs, l.text])
    )
    expect(twice.meta.title).toBe('三文錢')
  })

  it('offset 不會被套用兩次', () => {
    const once = parseLrc('[offset:+500]\n[00:10.00]詞')
    const twice = parseLrc(toLrc(once))
    // 9,500 both times. Writing the offset back out would make it 9,000.
    expect(twice.lines[0]!.timeMs).toBe(9500)
  })
})

describe('lineAt', () => {
  const lines: LyricLine[] = [
    { timeMs: 1000, text: '甲' },
    { timeMs: 5000, text: '乙' },
    { timeMs: 9000, text: '丙' },
    { timeMs: null, text: '沒時間的' },
  ]

  it('還沒到第一句時回 -1', () => {
    expect(lineAt(lines, 0)).toBe(-1)
    expect(lineAt(lines, 0.9)).toBe(-1)
  })

  it('剛好踩在時間點上就是那一句', () => {
    expect(lineAt(lines, 1)).toBe(0)
    expect(lineAt(lines, 5)).toBe(1)
  })

  it('兩句之間停在前一句', () => {
    expect(lineAt(lines, 4.9)).toBe(0)
    expect(lineAt(lines, 8.9)).toBe(1)
  })

  it('最後一句之後就停在最後一句', () => {
    expect(lineAt(lines, 999)).toBe(2)
  })

  it('不會選到沒有時間的那行', () => {
    // 它排在最後，但整首歌都不該輪到它亮起來。
    expect(lineAt(lines, 999)).not.toBe(3)
  })

  it('空的歌詞回 -1', () => {
    expect(lineAt([], 10)).toBe(-1)
  })

  it('二分搜尋跟從頭掃的答案一樣', () => {
    const many: LyricLine[] = Array.from({ length: 500 }, (_, i) => ({
      timeMs: i * 1000,
      text: `第 ${i} 句`,
    }))

    const scan = (seconds: number) => {
      let found = -1
      many.forEach((line, i) => {
        if (line.timeMs !== null && line.timeMs <= seconds * 1000) found = i
      })
      return found
    }

    for (const seconds of [0, 0.5, 1, 123.4, 250, 499, 499.999, 10_000]) {
      expect(lineAt(many, seconds)).toBe(scan(seconds))
    }
  })
})

describe('邊聽邊點', () => {
  const base: LyricLine[] = [
    { timeMs: null, text: '甲' },
    { timeMs: null, text: '乙' },
    { timeMs: null, text: '丙' },
  ]

  it('點一下蓋上現在的時間', () => {
    const next = stampLine(base, 1, 12.345)
    expect(next[1]!.timeMs).toBe(12_345)
  })

  it('不會動到原本的陣列', () => {
    stampLine(base, 0, 5)
    expect(base[0]!.timeMs).toBeNull()
  })

  it('不重新排序——不然下一句會從手指底下跑掉', () => {
    const next = stampLine(stampLine(base, 2, 1), 0, 9)
    expect(next.map((l) => l.text)).toEqual(['甲', '乙', '丙'])
    expect(next[0]!.timeMs).toBe(9000)
    expect(next[2]!.timeMs).toBe(1000)
  })

  it('點錯了可以清掉', () => {
    const stamped = stampLine(base, 1, 12.345)
    expect(clearStamp(stamped, 1)[1]!.timeMs).toBeNull()
  })

  it('超出範圍的索引不會爆', () => {
    expect(stampLine(base, -1, 5)).toBe(base)
    expect(stampLine(base, 99, 5)).toBe(base)
    expect(clearStamp(base, 99)).toBe(base)
  })

  it('進度只算有字的句子——間奏不用點', () => {
    const withGap: LyricLine[] = [
      { timeMs: 1000, text: '甲' },
      { timeMs: 2000, text: '' },
      { timeMs: null, text: '乙' },
    ]
    expect(stampProgress(withGap)).toEqual({ stamped: 1, total: 2 })
  })
})
