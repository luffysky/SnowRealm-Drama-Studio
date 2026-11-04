import { describe, expect, it } from 'vitest'
import {
  assignVoices,
  castChunks,
  isDialogue,
  knownNames,
  speakerOf,
  toneOf,
  TONE_SHAPE,
  type CastMember,
} from '@/lib/narration'

/**
 * 分角色朗讀（Z111）。
 *
 * 這組測試在守一條規矩：**寧可用旁白聲，也不要猜錯是誰在說話。**
 * 猜錯角色比完全不分角色更干擾——它等於用聲音斷言了一件假的事。
 *
 * 所以「沒有提示的對白」「只有代名詞」「名字不在這部作品裡」這三種情況
 * 都必須回 null，而不是回一個看起來合理的答案。
 */

const CAST = knownNames([
  { id: 'a', name: '沈知味' },
  { id: 'b', name: '許山河', alias: '許爺' },
])

describe('speakerOf', () => {
  it('名字在引號前面 ＋ 說話動詞', () => {
    expect(speakerOf('沈知味說：「不夠。」', CAST).name).toBe('沈知味')
    expect(speakerOf('許山河冷笑道：「三百文。」', CAST).name).toBe('許山河')
  })

  it('名字在引號後面', () => {
    expect(speakerOf('「不夠。」沈知味說。', CAST).name).toBe('沈知味')
    expect(speakerOf('「那就三文錢半。」許山河嘆了口氣。', CAST).name).toBe('許山河')
  })

  it('同段先出現名字，再有對白', () => {
    expect(speakerOf('沈知味把碗推過去，指尖在碗沿停了一下。「不夠。」', CAST).name).toBe(
      '沈知味'
    )
  })

  it('別名也算', () => {
    expect(speakerOf('許爺問：「收攤了？」', CAST).name).toBe('許山河')
  })

  /* ---- 以下是重點：不確定就不要猜 ---- */

  it('完全沒有提示的對白 → 旁白，不硬猜', () => {
    // 這本小說大量是這種。猜錯的代價比不分角色高。
    expect(speakerOf('「不夠。」', CAST).name).toBeNull()
    expect(speakerOf('「那就三文錢半。」', CAST).name).toBeNull()
  })

  it('只有代名詞 → 不解析', () => {
    // 代名詞要往前追整場戲，那正是這種剖析器開始「很有自信地錯」的地方。
    expect(speakerOf('她說：「不夠。」', CAST).name).toBeNull()
    expect(speakerOf('「不夠。」他冷笑道。', CAST).name).toBeNull()
  })

  it('名字不在這部作品裡 → 不算', () => {
    expect(speakerOf('林予安說：「這樣不太好吧。」', CAST).name).toBeNull()
  })

  it('沒有引號就不是對白', () => {
    expect(speakerOf('沈知味把灶上的火壓小了一些。', CAST).name).toBeNull()
  })

  it('沒有角色資料的時候一律旁白', () => {
    expect(speakerOf('沈知味說：「不夠。」', []).name).toBeNull()
  })
})

describe('knownNames', () => {
  it('長的標籤排前面，短的不會把長的蓋掉', () => {
    const names = knownNames([{ id: 'x', name: '沈知味', alias: '知味、阿味' }])
    expect(names[0]?.labels[0]).toBe('沈知味')
  })

  it('一個字的別名會被丟掉', () => {
    // 「沈」會打到「沈知味」「沈家」「沈默」，比沒有更糟。
    const names = knownNames([{ id: 'x', name: '沈知味', alias: '沈' }])
    expect(names[0]?.labels).not.toContain('沈')
  })
})

describe('toneOf', () => {
  it('驚嘆號跟喝斥的動詞算大聲', () => {
    expect(toneOf('「三百文攤租！」')).toBe('loud')
    expect(toneOf('「交出來。」', '他厲聲道')).toBe('loud')
  })

  it('低聲、喃喃、刪節號算輕', () => {
    expect(toneOf('「我知道了。」', '她低聲說')).toBe('soft')
    expect(toneOf('「可是……」')).toBe('soft')
  })

  it('問號算疑問', () => {
    expect(toneOf('「收攤了？」')).toBe('question')
  })

  it('其他就是平鋪直敘', () => {
    expect(toneOf('灶上的火壓小了一些。')).toBe('plain')
  })

  it('大聲比疑問優先：「你說什麼？！」是吼的', () => {
    expect(toneOf('「你說什麼？！」')).toBe('loud')
  })

  it('每一種語氣都有對應的語速音高，而且都在合理範圍', () => {
    for (const [tone, shape] of Object.entries(TONE_SHAPE)) {
      // Web Speech 的 rate 是 0.1–10、pitch 是 0–2，但這裡是乘在使用者
      // 自己的設定上的倍率，離 1 太遠就會變成怪腔怪調。
      expect(shape.rate, tone).toBeGreaterThan(0.7)
      expect(shape.rate, tone).toBeLessThan(1.4)
      expect(shape.pitch, tone).toBeGreaterThan(0.7)
      expect(shape.pitch, tone).toBeLessThan(1.4)
    }
  })
})

describe('assignVoices', () => {
  const VOICES = [
    { id: 'zh-A', lang: 'zh-TW' },
    { id: 'zh-B', lang: 'zh-CN' },
    { id: 'en-A', lang: 'en-US' },
  ]

  const cast: CastMember[] = [
    { id: 'a', name: '沈知味', gender: '女' },
    { id: 'b', name: '許山河', gender: '男' },
    { id: 'c', name: '路人', gender: '' },
  ]

  it('每個角色都拿到一組設定', () => {
    const map = assignVoices(cast, VOICES)
    expect(Object.keys(map).sort()).toEqual(['a', 'b', 'c'])
  })

  it('只用中文語音，英文的不會被配出去', () => {
    const map = assignVoices(cast, VOICES)
    for (const slot of Object.values(map)) {
      expect(slot.voiceId).not.toBe('en-A')
    }
  })

  it('同樣的輸入每次都給同樣的結果', () => {
    // 今天的沈知味跟明天的沈知味要是同一個聲音，這比「聰明的分配」重要。
    expect(assignVoices(cast, VOICES)).toEqual(assignVoices(cast, VOICES))
  })

  it('加進一個新角色不會把原本的洗牌', () => {
    const before = assignVoices(cast, VOICES)
    const after = assignVoices([...cast, { id: 'z', name: '新角色' }], VOICES)
    expect(after.a).toEqual(before.a)
    expect(after.b).toEqual(before.b)
  })

  it('女角音高比男角高', () => {
    const map = assignVoices(cast, VOICES)
    expect(map.a!.pitch).toBeGreaterThan(map.b!.pitch)
  })

  it('沒有人會拿到跟旁白一樣的音高', () => {
    // 旁白是 pitch 1。角色跟旁白分不出來，分角色就白做了。
    for (const slot of Object.values(assignVoices(cast, VOICES))) {
      expect(slot.pitch).not.toBe(1)
    }
  })

  it('存起來的覆寫，只有在這台機器真的有那個聲音時才用', () => {
    const withOverride: CastMember[] = [{ id: 'a', name: '沈知味', voiceId: 'zh-B' }]
    expect(assignVoices(withOverride, VOICES).a!.voiceId).toBe('zh-B')

    // 在別台機器上那個 voiceURI 不存在——塞給合成器會是沉默，不是退回預設。
    const elsewhere: CastMember[] = [{ id: 'a', name: '沈知味', voiceId: '別台機器的聲音' }]
    expect(assignVoices(elsewhere, VOICES).a!.voiceId).toBe('zh-A')
  })

  it('一個中文語音都沒有的時候，退而用現有的', () => {
    const map = assignVoices(cast, [{ id: 'en-A', lang: 'en-US' }])
    expect(map.a!.voiceId).toBe('en-A')
  })

  it('完全沒有語音也不會爆掉', () => {
    const map = assignVoices(cast, [])
    expect(map.a!.voiceId).toBeNull()
  })
})

describe('castChunks', () => {
  const cast: CastMember[] = [{ id: 'a', name: '沈知味', gender: '女' }]
  const voices = [{ id: 'zh-A', lang: 'zh-TW' }]

  const run = (paragraphs: string[]) =>
    castChunks(
      paragraphs.map((text, paragraph) => ({ text, paragraph })),
      paragraphs,
      cast,
      voices
    )

  it('旁白維持原樣，不被動到', () => {
    const [line] = run(['灶上的火壓小了一些。'])
    expect(line?.speaker).toBeNull()
    expect(line?.rate).toBe(1)
    expect(line?.pitch).toBe(1)
  })

  it('認不出說話者的對白，還是跟旁白不一樣', () => {
    /*
     * 這是這個功能在這本小說裡能不能成立的關鍵。
     * 實測第一章：238 段裡有 74 段對白，而且沒有任何一段在同一段裡寫出
     * 是誰說的。少了這一條，開關打開跟沒打開聽起來會完全一樣。
     */
    const [line] = run(['「不夠。」'])
    expect(line?.speaker).toBeNull()
    expect(line?.rate).toBeGreaterThan(1)
    expect(line?.pitch).toBeGreaterThan(1)
  })

  it('認得出說話者的時候用角色的聲音，不再另外加對白的提亮', () => {
    const [line] = run(['沈知味說：「不夠。」'])
    expect(line?.speaker).toBe('沈知味')
    expect(line?.voiceId).toBe('zh-A')
  })

  it('語氣疊在角色之上：同一個人吼的時候比較快', () => {
    const [calm] = run(['沈知味說：「不夠。」'])
    const [loud] = run(['沈知味喊道：「不夠！」'])
    expect(loud!.rate!).toBeGreaterThan(calm!.rate!)
  })

  it('同一段被切成好幾塊時，整段都算同一個人說的', () => {
    // 「沈知味說：」只出現在第一塊裡。逐塊判斷會在人家話講到一半換成旁白。
    const paragraph = '沈知味說：「' + '這句話很長，'.repeat(12) + '。」'
    const lines = castChunks(
      [
        { text: paragraph.slice(0, 40), paragraph: 0 },
        { text: paragraph.slice(40, 80), paragraph: 0 },
      ],
      [paragraph],
      cast,
      voices
    )
    expect(lines.map((l) => l.speaker)).toEqual(['沈知味', '沈知味'])
  })

  it('沒有角色資料就原封不動還回來', () => {
    const paragraphs = ['「不夠。」', '灶上的火壓小了一些。']
    const chunks = paragraphs.map((text, paragraph) => ({ text, paragraph }))
    expect(castChunks(chunks, paragraphs, [], voices)).toEqual(chunks)
  })
})

describe('isDialogue', () => {
  it('有引號就是有人在說話', () => {
    expect(isDialogue('「不夠。」')).toBe(true)
    expect(isDialogue('『不夠。』')).toBe(true)
  })

  it('沒有引號就是旁白', () => {
    expect(isDialogue('灶上的火壓小了一些。')).toBe(false)
  })
})
