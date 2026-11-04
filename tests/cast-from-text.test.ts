import { describe, expect, it } from 'vitest'
import { castChunks, castFromSpeakers, type CastMember, type VoiceOption } from '@/lib/narration'

/**
 * 從正文建音檔，而且音色是分開的（Z132）。
 *
 * 重點在**不必先去建角色表**。真正的正文裡角色表只有一個人，而對白有 2,657
 * 段——要求先把人建齊才能聽，等於這個功能永遠用不到。所以歸屬那一趟認出來的
 * 名字，就直接配音色。
 */

const VOICES: VoiceOption[] = [
  { id: 'v-f1', lang: 'zh-CN', gender: 'Female' },
  { id: 'v-f2', lang: 'zh-CN', gender: 'Female' },
  { id: 'v-m1', lang: 'zh-CN', gender: 'Male' },
  { id: 'v-m2', lang: 'zh-CN', gender: 'Male' },
]

const PARAGRAPHS = [
  '灶上的火光跳了一下。',
  '「這能買什麼？」',
  '「買一鍋雞皮，夠了。」',
  '「我不信。」',
]

const CHUNKS = PARAGRAPHS.map((text, paragraph) => ({ text, paragraph }))

describe('castFromSpeakers', () => {
  it('角色表裡有的人原封不動帶過來', () => {
    const known: CastMember[] = [
      { id: 'real-id', name: '沈知味', gender: '女', tier: 'LEAD', voiceId: 'v-f2' },
    ]
    const cast = castFromSpeakers(['沈知味'], known)

    expect(cast).toHaveLength(1)
    expect(cast[0]).toMatchObject({ id: 'real-id', gender: '女', voiceId: 'v-f2' })
  })

  it('表上沒有的人也配得到，拿一個從名字長出來的 id', () => {
    const cast = castFromSpeakers(['賣菜的老闆'], [])
    expect(cast[0]).toMatchObject({ id: 'name:賣菜的老闆', name: '賣菜的老闆' })
  })

  it('同一個名字每次都得到同一個 id——跨次一致比好聽重要', () => {
    const a = castFromSpeakers(['甲', '乙'], [])
    const b = castFromSpeakers(['乙', '甲'], [])
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id))
  })

  it('重複的名字只算一個', () => {
    expect(castFromSpeakers(['甲', '甲', '甲'], [])).toHaveLength(1)
  })

  it('空白名字不會變成一個角色', () => {
    expect(castFromSpeakers(['', '   '], [])).toHaveLength(0)
  })

  it('沒開口的人不佔音色', () => {
    const known: CastMember[] = [
      { id: '1', name: '有說話的', tier: 'LEAD' },
      { id: '2', name: '沒說話的', tier: 'LEAD' },
    ]
    const cast = castFromSpeakers(['有說話的'], known)
    expect(cast.map((c) => c.name)).toEqual(['有說話的'])
  })
})

describe('castChunks 吃歸屬結果', () => {
  it('角色表是空的，光靠歸屬也配得出不同音色', () => {
    const speakers = new Map([
      [1, '沈知味'],
      [2, '許山河'],
      [3, '沈知味'],
    ])
    const cast = castFromSpeakers([...speakers.values()], [])
    const casted = castChunks(CHUNKS, PARAGRAPHS, cast, VOICES, speakers)

    const voiceOf = (paragraph: number) =>
      casted.find((c) => c.paragraph === paragraph)?.voiceId ?? null

    expect(voiceOf(1)).not.toBeNull()
    expect(voiceOf(2)).not.toBeNull()
    // 兩個不同的人 → 兩個不同的音色，這就是「音色分開」。
    expect(voiceOf(1)).not.toBe(voiceOf(2))
    // 同一個人兩次 → 同一個音色。
    expect(voiceOf(3)).toBe(voiceOf(1))
  })

  it('旁白那一段不會被配給任何角色', () => {
    const speakers = new Map([[1, '沈知味']])
    const cast = castFromSpeakers(['沈知味'], [])
    const casted = castChunks(CHUNKS, PARAGRAPHS, cast, VOICES, speakers)

    expect(casted.find((c) => c.paragraph === 0)?.speaker ?? null).toBeNull()
    expect(casted.find((c) => c.paragraph === 0)?.voiceId ?? null).toBeNull()
  })

  it('歸屬的答案蓋過規則判出來的', () => {
    const paragraphs = ['沈知味說：「不夠。」']
    const chunks = [{ text: paragraphs[0]!, paragraph: 0 }]
    const cast: CastMember[] = [
      { id: 'a', name: '沈知味', gender: '女', tier: 'LEAD' },
      { id: 'b', name: '許山河', gender: '男', tier: 'LEAD' },
    ]

    const byRule = castChunks(chunks, paragraphs, cast, VOICES)
    expect(byRule[0]!.speaker).toBe('沈知味')

    // 規則看字面會判成沈知味；歸屬說是轉述，實際開口的是許山河。
    const byAttribution = castChunks(chunks, paragraphs, cast, VOICES, new Map([[0, '許山河']]))
    expect(byAttribution[0]!.speaker).toBe('許山河')
    expect(byAttribution[0]!.voiceId).not.toBe(byRule[0]!.voiceId)
  })

  it('沒有歸屬也沒有角色表時，行為跟以前一樣', () => {
    expect(castChunks(CHUNKS, PARAGRAPHS, [], VOICES)).toEqual(CHUNKS)
  })

  it('性別推得出來的人會配到對應性別的音色', () => {
    const known: CastMember[] = [
      { id: 'a', name: '沈知味', gender: '女', tier: 'LEAD' },
      { id: 'b', name: '許山河', gender: '男', tier: 'LEAD' },
    ]
    const speakers = new Map([
      [1, '沈知味'],
      [2, '許山河'],
    ])
    const casted = castChunks(
      CHUNKS,
      PARAGRAPHS,
      castFromSpeakers([...speakers.values()], known),
      VOICES,
      speakers
    )

    const voice = (paragraph: number) =>
      VOICES.find((v) => v.id === casted.find((c) => c.paragraph === paragraph)?.voiceId)

    expect(voice(1)?.gender).toBe('Female')
    expect(voice(2)?.gender).toBe('Male')
  })
})
