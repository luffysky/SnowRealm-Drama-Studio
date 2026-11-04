import { describe, expect, it } from 'vitest'
import { alignLyrics, type RecognisedWord } from '@/lib/lyrics-align'
import type { LyricLine } from '@/lib/lyrics'

/**
 * 用聽的幫歌詞標時間（Z131）。
 *
 * 核心主張只有一句：**辨識錯字不影響時間。** 唱歌辨識一定會錯，但錯的字在
 * 序列裡的位置還是對的，所以對齊之後時間照樣落在正確那一句上。這份測試幾乎
 * 整份都在壓這件事。
 */

function line(text: string): LyricLine {
  return { timeMs: null, text }
}

/** Builds recognised words at a steady pace, one entry per argument. */
function heard(...entries: [string, number, number][]): RecognisedWord[] {
  return entries.map(([text, startMs, durationMs]) => ({ text, startMs, durationMs }))
}

describe('完全聽對的情況', () => {
  it('每一句拿到自己第一個字的時間', () => {
    const result = alignLyrics(
      [line('三文錢'), line('買得起什麼')],
      heard(['三文錢', 1000, 900], ['買得起什麼', 2000, 1500])
    )

    expect(result.lines[0]!.timeMs).toBe(1000)
    expect(result.lines[1]!.timeMs).toBe(2000)
    expect(result.lines.every((l) => l.source === 'matched')).toBe(true)
    expect(result.coverage).toBe(1)
  })

  it('一個詞裡的字各自分到時間，不是全部算在詞頭', () => {
    // 「三文錢」從 1000 唱到 1900，第二個字不該還是 1000。
    const result = alignLyrics(
      [line('三'), line('文'), line('錢')],
      heard(['三文錢', 1000, 900])
    )

    expect(result.lines[0]!.timeMs).toBe(1000)
    expect(result.lines[1]!.timeMs).toBe(1300)
    expect(result.lines[2]!.timeMs).toBe(1600)
  })
})

describe('聽錯字的情況——這才是真正的使用情境', () => {
  it('中間聽錯幾個字，時間還是落在對的句子上', () => {
    const result = alignLyrics(
      [line('三文錢的生意'), line('一碗熱湯')],
      // 「三文錢」被聽成「山紋前」，整句只有「的生意」對。
      heard(['山紋前的生意', 1000, 1800], ['一碗熱湯', 4000, 1200])
    )

    expect(result.lines[1]!.timeMs).toBe(4000)
    // 第一句仍然拿得到時間，因為「的生意」對上了。
    expect(result.lines[0]!.timeMs).not.toBeNull()
    expect(result.lines[0]!.confidence).toBeGreaterThan(0)
    expect(result.lines[0]!.confidence).toBeLessThan(1)
  })

  it('多聽到不存在的字（伴奏雜訊）不會把後面全部推掉', () => {
    const result = alignLyrics(
      [line('一碗熱湯'), line('半生戴上耳機')],
      heard(['啊', 500, 200], ['一碗熱湯', 1000, 1200], ['嗯嗯', 2400, 300], ['半生戴上耳機', 3000, 2000])
    )

    expect(result.lines[0]!.timeMs).toBe(1000)
    expect(result.lines[1]!.timeMs).toBe(3000)
  })

  it('漏聽一整句會被夾在前後之間，而且標成猜的', () => {
    // 刻意讓三句沒有共用字：第一版的素材裡「完全沒聽到的一句」跟「第三句」
    // 共用一個「句」，那一個字就足以讓它拿到一個看起來很篤定的時間——
    // 實作現在會擋掉（見 MIN_MATCHED_CHARS），但素材本身也該乾淨。
    const result = alignLyrics(
      [line('灶上火光'), line('無人聽見的風'), line('鍋裡翻滾')],
      heard(['灶上火光', 1000, 500], ['鍋裡翻滾', 5000, 500])
    )

    const middle = result.lines[1]!
    expect(middle.source).toBe('interpolated')
    expect(middle.timeMs).toBeGreaterThan(1000)
    expect(middle.timeMs).toBeLessThan(5000)
    expect(middle.confidence).toBe(0)
  })

  it('頭尾漏聽不會亂猜——猜了會跑到歌還沒開始之前', () => {
    // 三句不共用字：第一版寫成「沒聽到的開頭／聽到的／沒聽到的結尾」，
    // 中間那句整個被前後兩句包含，對齊當然配到前面那一句去了。
    const result = alignLyrics(
      [line('前面沒錄到'), line('灶上火光'), line('後面也沒錄到')],
      heard(['灶上火光', 3000, 500])
    )

    expect(result.lines[0]!.timeMs).toBeNull()
    expect(result.lines[0]!.source).toBe('none')
    expect(result.lines[1]!.timeMs).toBe(3000)
    expect(result.lines[2]!.timeMs).toBeNull()
  })
})

describe('順序', () => {
  it('時間一定遞增；往回跳的那句寧可留空', () => {
    const result = alignLyrics(
      [line('甲'), line('乙'), line('丙')],
      // 「乙」在歌裡出現兩次，第二次在最後；對齊若選錯會造成倒退。
      heard(['甲', 1000, 200], ['丙', 2000, 200], ['乙', 9000, 200])
    )

    const times = result.lines.map((l) => l.timeMs).filter((t): t is number => t !== null)
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
    }
  })

  it('重複的副歌不會讓第二次的時間跑到第一次前面', () => {
    const lyrics = [line('副歌'), line('中間'), line('副歌')]
    const result = alignLyrics(
      lyrics,
      heard(['副歌', 1000, 400], ['中間', 2000, 400], ['副歌', 3000, 400])
    )

    expect(result.lines[0]!.timeMs).toBe(1000)
    expect(result.lines[1]!.timeMs).toBe(2000)
    expect(result.lines[2]!.timeMs).toBe(3000)
  })
})

describe('標點、空白與大小寫', () => {
  it('標點不參與比對——它不發聲', () => {
    const result = alignLyrics(
      [line('「三文錢，買得起什麼？」')],
      heard(['三文錢買得起什麼', 1000, 2000])
    )

    expect(result.lines[0]!.timeMs).toBe(1000)
    expect(result.lines[0]!.confidence).toBe(1)
  })

  it('英文不分大小寫', () => {
    const result = alignLyrics([line('Hello World')], heard(['hello world', 500, 800]))
    expect(result.lines[0]!.timeMs).toBe(500)
    expect(result.lines[0]!.confidence).toBe(1)
  })

  it('間奏那種沒有字的行不會拿到時間，也不拉低涵蓋率', () => {
    const result = alignLyrics(
      [line('有字'), line(''), line('也有字')],
      heard(['有字', 1000, 300], ['也有字', 5000, 300])
    )

    expect(result.lines[1]!.confidence).toBe(0)
    expect(result.coverage).toBe(1)
  })
})

describe('退化情況', () => {
  it('什麼都沒聽到就全部留空，不會硬編時間', () => {
    const result = alignLyrics([line('甲'), line('乙')], [])
    expect(result.lines.every((l) => l.timeMs === null)).toBe(true)
    expect(result.coverage).toBe(0)
  })

  it('沒有歌詞就沒有結果', () => {
    const result = alignLyrics([], heard(['甲', 0, 100]))
    expect(result.lines).toHaveLength(0)
    expect(result.coverage).toBe(0)
  })

  it('完全對不上就留空，而不是隨便配', () => {
    const result = alignLyrics(
      [line('完全不同的詞')],
      heard(['abcdefg', 1000, 500])
    )
    expect(result.lines[0]!.timeMs).toBeNull()
    expect(result.lines[0]!.confidence).toBe(0)
  })

  it('會把辨識到的原文帶回來——「它到底聽到什麼」', () => {
    const result = alignLyrics([line('甲')], heard(['山', 0, 100], ['紋', 100, 100]))
    expect(result.heard).toBe('山紋')
  })
})

describe('規模', () => {
  it('一首五分鐘的歌算得完，而且時間遞增', () => {
    // 60 句 × 8 字 ≈ 一首歌的規模。
    const lyrics = Array.from({ length: 60 }, (_, i) => line(`第${i}句歌詞內容在這`))
    const words = Array.from({ length: 60 }, (_, i): [string, number, number] => [
      `第${i}句歌詞內容在這`,
      i * 4000,
      3000,
    ])

    const started = Date.now()
    const result = alignLyrics(lyrics, heard(...words))
    const elapsed = Date.now() - started

    expect(result.coverage).toBeGreaterThan(0.9)
    expect(elapsed).toBeLessThan(3000)

    const times = result.lines.map((l) => l.timeMs!)
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
    }
  })
})
