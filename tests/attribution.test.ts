import { describe, expect, it } from 'vitest'
import {
  attributionCoverage,
  mergeAttribution,
  numbered,
  parseAttribution,
  planAttribution,
  type AttributionPlan,
} from '@/lib/attribution'
import type { CastMember } from '@/lib/narration'

/**
 * 這句話是誰說的（Z132）。
 *
 * 真正的正文裡，對白占 40%（2,657 段），而規則判得出來的是 **0 段**。所以
 * 這件事沒做，多角色有聲書就是一個人從頭唸到尾——它不是潤飾，是功能成不成立
 * 的分界。
 *
 * 錯的代價也不對稱：**沒歸屬**只是用旁白唸，聽起來平；**歸錯**是把許山河的話
 * 放進沈知味嘴裡，而聽的人會相信。所以這份測試盯的主要是「寧可不答，不要
 * 答錯」，以及模型回了髒東西時擋不擋得住。
 */

const CAST: CastMember[] = [
  { id: 'a', name: '沈知味', gender: '女', tier: 'LEAD' },
  { id: 'b', name: '許山河', gender: '男', tier: 'LEAD' },
]

/** 旁白、有標記的對白、沒標記的對白各幾段。 */
const PARAGRAPHS = [
  '灶上的火光跳了一下。',
  '沈知味說：「這能買什麼？」',
  '沒有人回答。',
  '「買一鍋雞皮，夠了。」',
  '「我不信。」',
  '門外的風停了。',
]

describe('planAttribution', () => {
  it('旁白不問——只有引號裡的話才有說話的人', () => {
    const plan = planAttribution(PARAGRAPHS, CAST)
    const touched = new Set([
      ...plan.settled.map((l) => l.index),
      ...plan.ask.map((l) => l.index),
    ])

    expect(touched.has(0)).toBe(false)
    expect(touched.has(2)).toBe(false)
    expect(touched.has(5)).toBe(false)
  })

  it('規則判得出來的不問模型', () => {
    const plan = planAttribution(PARAGRAPHS, CAST)

    expect(plan.settled.map((l) => l.index)).toEqual([1])
    expect(plan.settled[0]!.speaker).toBe('沈知味')
    expect(plan.ask.map((l) => l.index)).not.toContain(1)
  })

  it('沒標記的對白才是要問的', () => {
    const plan = planAttribution(PARAGRAPHS, CAST)
    expect(plan.ask.map((l) => l.index)).toEqual([3, 4])
  })

  it('角色表是空的，就全部都要問', () => {
    const plan = planAttribution(PARAGRAPHS, [])
    expect(plan.settled).toHaveLength(0)
    expect(plan.ask.map((l) => l.index)).toEqual([1, 3, 4])
  })

  it('可以設上限，避免一次問一整本書', () => {
    const plan = planAttribution(PARAGRAPHS, CAST, { maxLines: 1 })
    expect(plan.ask).toHaveLength(1)
  })

  it('模型讀到的是整段正文，不是只有要問的那幾句', () => {
    const plan = planAttribution(PARAGRAPHS, CAST)
    // 誰說了沒標記的那一句，是靠前後文決定的。
    expect(plan.excerpt).toContain('灶上的火光')
    expect(plan.excerpt).toContain('門外的風停了')
  })
})

describe('numbered', () => {
  it('段號跟陣列索引一致', () => {
    const text = numbered(['甲', '乙', '丙'])
    expect(text.split('\n')).toEqual(['[0] 甲', '[1] 乙', '[2] 丙'])
  })
})

/* -------------------------------------------------------------------------- */

const plan: AttributionPlan = {
  settled: [{ index: 1, speaker: '沈知味', evidence: '沈知味…說' }],
  ask: [
    { index: 3, text: '「買一鍋雞皮，夠了。」' },
    { index: 4, text: '「我不信。」' },
  ],
  excerpt: '',
  cast: ['沈知味', '許山河'],
}

describe('parseAttribution 的容錯', () => {
  const good = JSON.stringify([
    { index: 3, speaker: '許山河', confidence: 0.9, reason: '上一句是沈知味問的' },
    { index: 4, speaker: '沈知味', confidence: 0.8, reason: '一來一往' },
  ])

  it('乾淨的 JSON', () => {
    const result = parseAttribution(good, plan)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toMatchObject({ index: 3, speaker: '許山河', isNew: false })
  })

  it('包在 markdown 圍欄裡也讀得出來', () => {
    const result = parseAttribution('```json\n' + good + '\n```', plan)
    expect(result.lines).toHaveLength(2)
  })

  it('前後多了幾句廢話也讀得出來', () => {
    const result = parseAttribution(`我分析如下：\n${good}\n希望這樣有幫助。`, plan)
    expect(result.lines).toHaveLength(2)
  })

  it('包在物件裡也讀得出來', () => {
    const result = parseAttribution(JSON.stringify({ lines: JSON.parse(good) }), plan)
    expect(result.lines).toHaveLength(2)
  })

  it('完全不是 JSON 就回空的，不會丟例外', () => {
    const result = parseAttribution('我覺得第三段是許山河說的。', plan)
    expect(result.lines).toHaveLength(0)
    expect(result.rejected[0]!.reason).toMatch(/找不到 JSON/)
  })
})

describe('parseAttribution 的把關', () => {
  it('沒問過的段號會被丟掉——它可能是編出來的', () => {
    const result = parseAttribution(
      JSON.stringify([{ index: 99, speaker: '沈知味', confidence: 1 }]),
      plan
    )
    expect(result.lines).toHaveLength(0)
    expect(result.rejected[0]).toMatchObject({ index: 99 })
  })

  it('規則已經判定的那一段，模型說什麼都不收', () => {
    const result = parseAttribution(
      JSON.stringify([{ index: 1, speaker: '許山河', confidence: 1 }]),
      plan
    )
    expect(result.lines).toHaveLength(0)
  })

  it('同一段回兩次只收第一次', () => {
    const result = parseAttribution(
      JSON.stringify([
        { index: 3, speaker: '許山河', confidence: 0.9 },
        { index: 3, speaker: '沈知味', confidence: 0.9 },
      ]),
      plan
    )
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.speaker).toBe('許山河')
    expect(result.rejected[0]!.reason).toMatch(/兩次/)
  })

  it('段號不是整數就丟掉', () => {
    const result = parseAttribution(
      JSON.stringify([{ index: '第三段', speaker: '許山河' }]),
      plan
    )
    expect(result.lines).toHaveLength(0)
  })

  it('角色表沒有的人會被標成新的，而且收集起來', () => {
    const result = parseAttribution(
      JSON.stringify([{ index: 3, speaker: '賣菜的老闆', confidence: 0.9 }]),
      plan
    )
    expect(result.lines[0]).toMatchObject({ isNew: true, speaker: '賣菜的老闆' })
    expect(result.newNames).toEqual(['賣菜的老闆'])
  })

  it('模型說不知道就是不知道，不會硬塞一個人', () => {
    const result = parseAttribution(
      JSON.stringify([{ index: 3, speaker: null, confidence: 0.2, reason: '看不出來' }]),
      plan
    )
    expect(result.lines[0]!.speaker).toBeNull()
  })
})

describe('信心度', () => {
  const read = (confidence: unknown) =>
    parseAttribution(
      JSON.stringify([{ index: 3, speaker: '許山河', confidence }]),
      plan
    ).lines[0]!.confidence

  it('0.8 / 80 / "80%" 都是同一件事', () => {
    expect(read(0.8)).toBeCloseTo(0.8)
    expect(read(80)).toBeCloseTo(0.8)
    expect(read('80%')).toBeCloseTo(0.8)
  })

  it('沒給就當作不確定，不是當作確定', () => {
    // 錯的代價是把別人的話放進某個角色嘴裡，所以沉默不能讀成肯定。
    expect(read(undefined)).toBe(0)
    expect(read('大概吧')).toBe(0)
  })

  it('超出範圍就夾住', () => {
    expect(read(500)).toBe(1)
    expect(read(-3)).toBe(0)
  })
})

describe('mergeAttribution', () => {
  const result = parseAttribution(
    JSON.stringify([
      { index: 3, speaker: '許山河', confidence: 0.9 },
      { index: 4, speaker: '沈知味', confidence: 0.3 },
    ]),
    plan
  )

  it('規則的答案一定留著', () => {
    expect(mergeAttribution(plan, result).get(1)).toBe('沈知味')
  })

  it('夠確定的才收', () => {
    const merged = mergeAttribution(plan, result)
    expect(merged.get(3)).toBe('許山河')
    // 0.3 低於門檻：寧可用旁白唸，也不要把話放錯人嘴裡。
    expect(merged.has(4)).toBe(false)
  })

  it('門檻可以調', () => {
    expect(mergeAttribution(plan, result, { minConfidence: 0.2 }).get(4)).toBe('沈知味')
  })

  it('角色表沒有的人預設不收——它沒有音色可以配', () => {
    const withNew = parseAttribution(
      JSON.stringify([{ index: 3, speaker: '賣菜的老闆', confidence: 1 }]),
      plan
    )
    expect(mergeAttribution(plan, withNew).has(3)).toBe(false)
    expect(mergeAttribution(plan, withNew, { includeNew: true }).get(3)).toBe('賣菜的老闆')
  })
})

describe('attributionCoverage', () => {
  it('分得出哪些是規則判的、哪些是模型補的', () => {
    const result = parseAttribution(
      JSON.stringify([{ index: 3, speaker: '許山河', confidence: 0.9 }]),
      plan
    )
    const merged = mergeAttribution(plan, result)

    expect(attributionCoverage(plan, merged)).toEqual({
      dialogue: 3,
      attributed: 2,
      fromRules: 1,
      fromModel: 1,
    })
  })
})
