import { describe, expect, it } from 'vitest'
import type { CastedChunk } from '@/lib/narration'
import {
  batchChunks,
  billableChars,
  escapeXml,
  estimatedSeconds,
  prosodyPercent,
  ssmlFor,
  TTS_LIMITS,
} from '@/lib/tts/ssml'

/**
 * 有聲小說的 SSML（Z129）。
 *
 * 這一層沒有網路，是刻意的：多角色旁白要嘛對、要嘛安靜地錯，而「聽一個
 * 31 分鐘的檔案才發現錯了」是最糟的回饋迴圈。
 */

const options = { locale: 'zh-TW', narratorVoice: 'zh-TW-HsiaoChenNeural' }

function chunk(text: string, extra: Partial<CastedChunk> = {}): CastedChunk {
  return { text, paragraph: 0, ...extra }
}

describe('escapeXml', () => {
  it('只跳脫 & < >', () => {
    expect(escapeXml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('不動中文引號——那是這部小說大半的標點', () => {
    const line = '「三文錢，買得起什麼？」'
    expect(escapeXml(line)).toBe(line)
  })

  it('先換 & 才不會把跳脫後的實體再跳脫一次', () => {
    // '<' → '&lt;' 之後若再處理 '&'，就會變成 '&amp;lt;'
    expect(escapeXml('<')).toBe('&lt;')
    expect(escapeXml('&lt;')).toBe('&amp;lt;')
  })
})

describe('prosodyPercent', () => {
  it('倍率換成帶正負號的百分比', () => {
    expect(prosodyPercent(1, 100)).toBe('+0%')
    expect(prosodyPercent(1.05, 100)).toBe('+5%')
    expect(prosodyPercent(0.9, 100)).toBe('-10%')
  })

  it('超出 Azure 接受的範圍就夾住，而不是送出去被退', () => {
    expect(prosodyPercent(5, 50)).toBe('+50%')
    expect(prosodyPercent(0.1, 50)).toBe('-50%')
  })

  it('壞數字不會變成 NaN%', () => {
    expect(prosodyPercent(Number.NaN, 100)).toBe('+0%')
    expect(prosodyPercent(Number.POSITIVE_INFINITY, 100)).toBe('+0%')
  })

  it('narration.ts 的語氣倍率都落在範圍內，不會被夾到', async () => {
    const { TONE_SHAPE, DIALOGUE_SHAPE } = await import('@/lib/narration')
    for (const shape of [...Object.values(TONE_SHAPE), DIALOGUE_SHAPE]) {
      expect(prosodyPercent(shape.rate, 100)).toBe(prosodyPercent(shape.rate, 1000))
      expect(prosodyPercent(shape.pitch, 50)).toBe(prosodyPercent(shape.pitch, 1000))
    }
  })
})

describe('ssmlFor', () => {
  it('沒有角色的段落用旁白音色', () => {
    const xml = ssmlFor([chunk('灶上火光一跳。')], options)
    expect(xml).toContain('<voice name="zh-TW-HsiaoChenNeural">')
    expect(xml).toContain('灶上火光一跳。')
    expect(xml.startsWith('<speak')).toBe(true)
    expect(xml.endsWith('</speak>')).toBe(true)
  })

  it('一份文件裡可以有好幾個音色——多角色才不用拆成好幾個請求', () => {
    const xml = ssmlFor(
      [
        chunk('沈知味說：'),
        chunk('「三文錢。」', { voiceId: 'zh-CN-XiaoxiaoNeural' }),
        chunk('許山河沒應聲。'),
      ],
      options
    )
    expect(xml).toContain('zh-CN-XiaoxiaoNeural')
    expect((xml.match(/<voice /g) ?? []).length).toBe(3)
  })

  it('連續相同音色與語氣會合併，不會每段包一層', () => {
    const many = Array.from({ length: 20 }, (_, i) => chunk(`第 ${i} 段。`))
    const xml = ssmlFor(many, options)

    // One wrapper for all twenty, not twenty.
    expect((xml.match(/<voice /g) ?? []).length).toBe(1)
    expect((xml.match(/<prosody /g) ?? []).length).toBe(1)
  })

  it('語氣變了就另開一個 prosody，但音色不變就不重開 voice', () => {
    const xml = ssmlFor(
      [chunk('平鋪直敘。'), chunk('「住手！」', { rate: 1.1, pitch: 1.15 })],
      options
    )
    expect((xml.match(/<voice /g) ?? []).length).toBe(1)
    expect((xml.match(/<prosody /g) ?? []).length).toBe(2)
    expect(xml).toContain('rate="+10%"')
    expect(xml).toContain('pitch="+15%"')
  })

  it('每個標籤都有收尾，XML 是平衡的', () => {
    const xml = ssmlFor(
      [
        chunk('旁白。'),
        chunk('「對白。」', { voiceId: 'zh-CN-YunxiNeural', rate: 1.05 }),
        chunk('旁白又回來了。'),
      ],
      options
    )
    const opens = (xml.match(/<voice /g) ?? []).length
    const closes = (xml.match(/<\/voice>/g) ?? []).length
    expect(opens).toBe(closes)
    expect((xml.match(/<prosody /g) ?? []).length).toBe(
      (xml.match(/<\/prosody>/g) ?? []).length
    )
  })

  it('空白的段落不會產生空元素', () => {
    const xml = ssmlFor([chunk('   '), chunk('有字。')], options)
    expect((xml.match(/<voice /g) ?? []).length).toBe(1)
  })

  it('段落之間有停頓，不然整章會黏成一條', () => {
    const xml = ssmlFor([chunk('一。'), chunk('二。')], options)
    expect((xml.match(/<break /g) ?? []).length).toBe(2)
  })

  it('正文裡的 & 會被跳脫,產出仍是合法 XML', () => {
    const xml = ssmlFor([chunk('湯 & 飯')], options)
    expect(xml).toContain('湯 &amp; 飯')
    expect(xml).not.toMatch(/湯 & 飯/)
  })
})

describe('batchChunks', () => {
  it('一整集會切成幾個不超過上限的請求', () => {
    // 7,400 字——這部小說一集的實際規模。
    const chunks = Array.from({ length: 185 }, (_, i) => chunk('四十個字'.repeat(10), { paragraph: i }))
    const batches = batchChunks(chunks)

    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      expect(batch.chars).toBeLessThanOrEqual(TTS_LIMITS.MAX_CHARS_PER_REQUEST)
      expect(batch.estimatedSec).toBeLessThanOrEqual(TTS_LIMITS.MAX_SECONDS_PER_REQUEST + 1)
    }
  })

  it('一個字都不會掉', () => {
    const chunks = Array.from({ length: 50 }, (_, i) => chunk(`段落${i}`.repeat(30), { paragraph: i }))
    const batches = batchChunks(chunks, 200)

    const before = chunks.map((c) => c.text).join('')
    const after = batches.flatMap((b) => b.chunks.map((c) => c.text)).join('')
    expect(after).toBe(before)
  })

  it('只在段落之間切，不會把一段切成兩半', () => {
    const chunks = [chunk('一'.repeat(40)), chunk('二'.repeat(40)), chunk('三'.repeat(40))]
    const batches = batchChunks(chunks, 50)

    for (const batch of batches) {
      for (const c of batch.chunks) {
        // Every chunk arrives whole, in exactly one batch.
        expect(c.text.length).toBe(40)
      }
    }
    expect(batches.flatMap((b) => b.chunks)).toHaveLength(3)
  })

  it('短的一集就是一個請求', () => {
    expect(batchChunks([chunk('很短。')])).toHaveLength(1)
  })

  it('沒有東西就沒有請求——不會送一個空的出去花錢', () => {
    expect(batchChunks([])).toHaveLength(0)
    expect(batchChunks([chunk('  '), chunk('')])).toHaveLength(0)
  })
})

describe('計價與長度', () => {
  it('計費字元只算正文，不算標籤', () => {
    const chunks = [chunk('十個字十個字'), chunk('五個字')]
    expect(billableChars(chunks)).toBe(6 + 3)

    // The markup is several times the prose; billing it would be wrong by
    // more than it is right.
    const xml = ssmlFor(chunks, options)
    expect(xml.length).toBeGreaterThan(billableChars(chunks) * 3)
  })

  it('一集 7,400 字的預估長度與費用算得出來', () => {
    const chars = 7400
    const chunks = [chunk('字'.repeat(chars))]

    expect(billableChars(chunks)).toBe(chars)
    const seconds = estimatedSeconds(chunks)
    expect(seconds).toBeCloseTo(chars / TTS_LIMITS.CHARS_PER_SEC, 5)
    // Just over half an hour of audio, which is the real finding here: one
    // episode of prose is nothing like one episode of drama.
    expect(seconds / 60).toBeGreaterThan(30)
  })
})
