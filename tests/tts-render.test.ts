import { describe, expect, it } from 'vitest'
import { nextPartIndex, partKey, renderSummary, type RenderedPart } from '@/lib/tts/render'

/**
 * 合成的續跑狀態（Z129）。
 *
 * 一集大約三十分鐘的音檔，worker 的函式上限是 60 秒，所以一定會分好幾次做完。
 * 「哪一段還沒做」錯掉的代價很具體：**重複做一段是多花一次錢，跳過一段是聽到
 * 一半突然跳掉**。所以這一層是純函式，而且測得比較兇。
 */

function part(index: number, bytes = 1000, sec = 45): RenderedPart {
  return { index, objectKey: partKey('job', index), bytes, sec }
}

describe('nextPartIndex', () => {
  it('什麼都還沒做就從第一段開始', () => {
    expect(nextPartIndex(5, [])).toBe(0)
  })

  it('依序往下', () => {
    expect(nextPartIndex(5, [part(0)])).toBe(1)
    expect(nextPartIndex(5, [part(0), part(1)])).toBe(2)
  })

  it('全部做完回 null', () => {
    expect(nextPartIndex(3, [part(0), part(1), part(2)])).toBeNull()
  })

  it('中間漏掉的那一段會被補上，而不是從最後面接下去', () => {
    // 第 1 段逾時沒做完，第 2 段做了。接下來該做的是 1，不是 3。
    expect(nextPartIndex(4, [part(0), part(2)])).toBe(1)
  })

  it('順序亂掉也找得對', () => {
    expect(nextPartIndex(4, [part(3), part(0), part(1)])).toBe(2)
  })

  it('重複記錄的同一段不會讓它跳過別段', () => {
    expect(nextPartIndex(3, [part(0), part(0), part(1)])).toBe(2)
  })

  it('沒有東西要做就是 null，不會回 0', () => {
    expect(nextPartIndex(0, [])).toBeNull()
  })
})

describe('renderSummary', () => {
  it('算進度', () => {
    expect(renderSummary(4, [part(0), part(1)])).toMatchObject({
      done: 2,
      total: 4,
      percent: 50,
    })
  })

  it('重複的那一段只算一次——不會出現 43 / 42 段', () => {
    const summary = renderSummary(2, [part(0), part(0), part(1)])
    expect(summary.done).toBe(2)
    expect(summary.percent).toBe(100)
  })

  it('大小與長度也不會被重複的那一段灌水', () => {
    const summary = renderSummary(2, [part(0, 500, 45), part(0, 500, 45), part(1, 700, 30)])
    expect(summary.bytes).toBe(1200)
    expect(summary.sec).toBe(75)
  })

  it('什麼都還沒做是 0%，不是 NaN', () => {
    expect(renderSummary(5, []).percent).toBe(0)
    expect(renderSummary(0, []).percent).toBe(0)
  })
})

describe('partKey', () => {
  it('補零，所以照字母排就是照順序排', () => {
    expect(partKey('abc', 0)).toBe('tmp/tts/abc/0000.mp3')
    expect(partKey('abc', 42)).toBe('tmp/tts/abc/0042.mp3')

    // 第 9 段要排在第 10 段前面，沒補零的話字串排序會把 10 排到 9 前面。
    const keys = [partKey('j', 9), partKey('j', 10)]
    expect([...keys].sort()).toEqual(keys)
  })

  it('不同工作不會互相覆蓋', () => {
    expect(partKey('one', 0)).not.toBe(partKey('two', 0))
  })

  it('放在暫存路徑下，掃得掉', () => {
    expect(partKey('j', 0).startsWith('tmp/')).toBe(true)
  })
})
