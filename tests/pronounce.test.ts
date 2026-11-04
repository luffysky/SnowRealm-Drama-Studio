import { describe, expect, it } from 'vitest'
import {
  canCorrect,
  IGNORES_PHONEME,
  LEXICON,
  markReadings,
  phonemeSpelling,
  spell,
  type LexiconEntry,
} from '@/lib/tts/pronounce'
import { isSceneBreak, speakableText, stripInlineMarkup } from '@/lib/speech-text'
import { splitForSpeech } from '@/lib/speech-split'
import { emotionOf, styleFor } from '@/lib/tts/style'
import { ssmlFor, batchChunks } from '@/lib/tts/ssml'

/**
 * 三個使用者用耳朵抓到的毛病，各自釘一個測試 (Z140).
 *
 * 這三件事的共同點是**不會報錯**：念星號、念錯破音字、語氣平淡，全部回 200，
 * 全部產出一個播得出來的檔案。只有聽完才會發現，而一集是十五分鐘。所以它們
 * 必須在這裡被攔下來，不是在耳朵那裡。
 */

/* -------------------------------------------------------------------------- */
/* 念星號                                                                      */
/* -------------------------------------------------------------------------- */

describe('排版符號不要唸出來', () => {
  it('把 * * * 當成場景分隔線', () => {
    expect(isSceneBreak('* * *')).toBe(true)
    expect(isSceneBreak('***')).toBe(true)
    expect(isSceneBreak('---')).toBe(true)
    expect(isSceneBreak('※ ※ ※')).toBe(true)
  })

  it('一個符號不算——那更可能是正文被切壞', () => {
    expect(isSceneBreak('*')).toBe(false)
    expect(isSceneBreak('-')).toBe(false)
  })

  it('正文不算，哪怕裡面有符號', () => {
    expect(isSceneBreak('他說：「三兩銀子。」')).toBe(false)
    expect(isSceneBreak('湯*很燙')).toBe(false)
  })

  it('成對的強調脫殼，留下字', () => {
    expect(stripInlineMarkup('**一灶見山河**')).toBe('一灶見山河')
    expect(stripInlineMarkup('他說`好`')).toBe('他說好')
    expect(stripInlineMarkup('## 第一章')).toBe('第一章')
  })

  it('落單的星號掃掉，不是唸出來', () => {
    expect(stripInlineMarkup('三兩*銀子')).toBe('三兩銀子')
  })

  it('整段是分隔線就沒有可唸的東西', () => {
    expect(speakableText('* * *')).toBeNull()
    expect(speakableText('沈知味抬起頭。')).toBe('沈知味抬起頭。')
  })

  /**
   * 這是使用者聽到的那一句的回歸測試。
   *
   * 分隔線變成**帶著 pauseMs 的空白塊**，不是消失——場景換了而聲音一路接
   * 下去，聽起來就是前一場的話還沒說完。
   */
  it('切段之後，分隔線是靜音而不是三個字', () => {
    const chunks = splitForSpeech(['第一場。', '* * *', '第二場。'])

    const spoken = chunks.filter((chunk) => chunk.text.trim())
    expect(spoken.map((chunk) => chunk.text)).toEqual(['第一場。', '第二場。'])

    const pauses = chunks.filter((chunk) => chunk.pauseMs)
    expect(pauses).toHaveLength(1)
    expect(pauses[0]!.text).toBe('')
    expect(pauses[0]!.pauseMs).toBeGreaterThan(0)

    // 沒有任何一塊含星號——這就是使用者聽到「星號星號星號」的那個條件。
    expect(chunks.some((chunk) => chunk.text.includes('*'))).toBe(false)
  })

  it('靜音不會在切批次的時候被丟掉', () => {
    const batches = batchChunks([
      { text: '第一場。', paragraph: 0 },
      { text: '', paragraph: 1, pauseMs: 1200 },
      { text: '第二場。', paragraph: 2 },
    ])

    const all = batches.flatMap((batch) => batch.chunks)
    expect(all.filter((chunk) => chunk.pauseMs)).toHaveLength(1)
  })

  it('SSML 裡那段靜音是 break，而且待在 voice 裡面', () => {
    const ssml = ssmlFor([{ text: '', paragraph: 0, pauseMs: 1200 }], {
      locale: 'zh-TW',
      narratorVoice: 'zh-TW-HsiaoChenNeural',
    })

    expect(ssml).toContain('<break time="1200ms"/>')
    // `<speak>` 底下直接放 break，Azure 不收。
    expect(ssml.indexOf('<voice')).toBeLessThan(ssml.indexOf('<break time'))
    expect(ssml).toContain('</voice>')
  })
})

/* -------------------------------------------------------------------------- */
/* 破音字                                                                      */
/* -------------------------------------------------------------------------- */

describe('破音字', () => {
  it('還錢的還標上 ㄏㄨㄢˊ', () => {
    const segments = markReadings('我來還錢')
    const marked = segments.filter((segment) => segment.reading)

    expect(marked).toHaveLength(1)
    expect(marked[0]!.text).toBe('還')
    expect(marked[0]!.reading!.bopomofo).toBe('ㄏㄨㄢˊ')
  })

  /**
   * 這條比上面那條重要。
   *
   * 「還」在這部小說裡出現一百六十次以上，其中「還有」「還是」「還沒」是
   * ㄏㄞˊ 而且本來就唸對了。按字改會把對的一起改錯——那是比原來的毛病更大
   * 的毛病，因為它影響的句子多十倍。
   */
  it('還有、還是、還沒一個都不碰', () => {
    for (const text of ['還有三兩', '還是不夠', '他還沒來', '還能怎樣']) {
      expect(markReadings(text).every((segment) => !segment.reading)).toBe(true)
    }
  })

  it('頓了頓的兩個頓都標上，中間的了不動', () => {
    const segments = markReadings('他頓了頓')
    const marked = segments.filter((segment) => segment.reading)

    expect(marked).toHaveLength(2)
    expect(marked.map((segment) => segment.text)).toEqual(['頓', '頓'])
    expect(marked[0]!.reading!.bopomofo).toBe('ㄉㄨㄣˋ')
  })

  it('長的詞贏——少東家不會被少東先標掉', () => {
    const segments = markReadings('那位少東家')
    const marked = segments.filter((segment) => segment.reading)

    expect(marked).toHaveLength(1)
    expect(marked[0]!.reading!.bopomofo).toBe('ㄕㄠˋ')
    // 整個詞都還在，一個字都沒掉。
    expect(segments.map((segment) => segment.text).join('')).toBe('那位少東家')
  })

  it('一個字只標一次，重疊的規則不會疊起來', () => {
    const segments = markReadings('還錢還給他')
    const marked = segments.filter((segment) => segment.reading)
    expect(marked).toHaveLength(2)
  })

  it('不管標了幾個字，接回去必須跟原文一樣', () => {
    for (const text of ['他頓了頓，盛了一碗麵，說要還錢', '還有少東家在數錢', '']) {
      expect(markReadings(text).map((segment) => segment.text).join('')).toBe(text)
    }
  })

  it('規則寫錯位置時忽略那一條，不要去標到別的字', () => {
    const broken: LexiconEntry[] = [
      { word: '麵', marks: [{ at: 5, reading: { bopomofo: 'ㄇㄧㄢˋ', pinyin: 'mian 4' } }], why: '故意寫錯' },
    ]
    const segments = markReadings('一碗麵', broken)
    expect(segments.every((segment) => !segment.reading)).toBe(true)
  })
})

/**
 * 這張表是量出來的，不是查來的 (`scripts/probe-phoneme.ts`).
 *
 * 寫成測試是因為它**只是一組字串比對**，而字串比對永遠編得過。送錯拼寫是
 * HTTP 400，而一次 400 會讓整個批次白跑——那不是一個應該靠記憶維持的規則。
 */
describe('哪一種音色吃哪一種拼寫', () => {
  it('台灣的音色只吃注音', () => {
    expect(phonemeSpelling('zh-TW-HsiaoChenNeural')).toBe('bopomofo')
    expect(spell({ bopomofo: 'ㄏㄨㄢˊ', pinyin: 'huan 2' }, 'zh-TW-HsiaoChenNeural')).toBe('ㄏㄨㄢˊ')
  })

  it('大陸的音色只吃拼音，而且聲調前面有空格', () => {
    expect(phonemeSpelling('zh-CN-XiaoxiaoNeural')).toBe('pinyin')
    const ph = spell({ bopomofo: 'ㄏㄨㄢˊ', pinyin: 'huan 2' }, 'zh-CN-XiaoxiaoNeural')
    expect(ph).toBe('huan 2')
    // 這個空格就是上一輪漏掉、因而得出「zh-CN 不支援」那個錯結論的原因。
    expect(ph).toMatch(/ \d$/)
  })

  it('粵語、吳語、多語言一律不送——實測是 400', () => {
    for (const voice of [
      'zh-HK-HiuMaanNeural',
      'yue-CN-XiaoMinNeural',
      'wuu-CN-XiaotongNeural',
      'en-US-AvaMultilingualNeural',
    ]) {
      expect(phonemeSpelling(voice)).toBe('none')
      expect(spell({ bopomofo: 'ㄏㄨㄢˊ', pinyin: 'huan 2' }, voice)).toBeNull()
      expect(canCorrect(voice)).toBe(false)
    }
  })

  it('收下來卻忽略的那幾個，改不動破音字', () => {
    expect(IGNORES_PHONEME.size).toBeGreaterThan(0)
    for (const voice of IGNORES_PHONEME) {
      expect(canCorrect(voice)).toBe(false)
    }
  })

  it('字典裡每一條都兩種拼寫都有，而且拼音都帶空格聲調', () => {
    for (const entry of LEXICON) {
      expect(entry.word.length).toBeGreaterThan(0)
      expect(entry.why.trim().length).toBeGreaterThan(0)
      for (const mark of entry.marks) {
        expect(mark.at).toBeGreaterThanOrEqual(0)
        expect(mark.at).toBeLessThan(entry.word.length)
        expect(mark.reading.bopomofo).toMatch(/^[㄀-ㄯˇˊˋ˙]+$/)
        expect(mark.reading.pinyin).toMatch(/^[a-z]+( [1-5])+$/)
      }
    }
  })
})

describe('SSML 裡的 phoneme', () => {
  it('台灣音色輸出注音', () => {
    const ssml = ssmlFor([{ text: '我來還錢', paragraph: 0 }], {
      locale: 'zh-TW',
      narratorVoice: 'zh-TW-HsiaoChenNeural',
    })
    expect(ssml).toContain('<phoneme alphabet="sapi" ph="ㄏㄨㄢˊ">還</phoneme>')
  })

  it('大陸音色輸出拼音', () => {
    const ssml = ssmlFor([{ text: '我來還錢', paragraph: 0 }], {
      locale: 'zh-TW',
      narratorVoice: 'zh-CN-XiaoxiaoNeural',
    })
    expect(ssml).toContain('ph="huan 2"')
    expect(ssml).not.toContain('ㄏㄨㄢˊ')
  })

  /** 不支援的音色一個 phoneme 都不能帶——帶了就是 400，整批白跑。 */
  it('多語言音色完全不帶 phoneme', () => {
    const ssml = ssmlFor([{ text: '我來還錢', paragraph: 0 }], {
      locale: 'zh-TW',
      narratorVoice: 'en-US-AvaMultilingualNeural',
    })
    expect(ssml).not.toContain('<phoneme')
    expect(ssml).toContain('我來還錢')
  })

  it('照音色各自決定，同一份 SSML 裡兩種拼寫並存', () => {
    const ssml = ssmlFor(
      [
        { text: '我來還錢', paragraph: 0, voiceId: 'zh-TW-HsiaoChenNeural' },
        { text: '還錢再說', paragraph: 1, voiceId: 'zh-CN-XiaoxiaoNeural' },
      ],
      { locale: 'zh-TW', narratorVoice: 'zh-TW-HsiaoChenNeural' }
    )
    expect(ssml).toContain('ph="ㄏㄨㄢˊ"')
    expect(ssml).toContain('ph="huan 2"')
  })
})

/* -------------------------------------------------------------------------- */
/* 情緒風格                                                                    */
/* -------------------------------------------------------------------------- */

describe('從正文讀情緒', () => {
  it('寫出來的才算', () => {
    expect(emotionOf('「你說什麼」', '許山河怒道：')).toBe('angry')
    expect(emotionOf('「別出聲」', '他壓低了聲音')).toBe('whispering')
    expect(emotionOf('「我不行了」', '她嘆了口氣')).toBe('sad')
    expect(emotionOf('「好吃」', '沈知味笑了')).toBe('cheerful')
  })

  it('沒寫就是沒有，不要猜', () => {
    expect(emotionOf('「三兩銀子。」', '他說：')).toBeNull()
    expect(emotionOf('沈知味把碗推過去。')).toBeNull()
  })

  /**
   * 冷笑、苦笑、譏笑**全部含「笑」而全部不是開心**。漏掉這一條，一句譏諷
   * 就會用歡快的聲音唸出來——那正是風格猜錯最難聽的樣子。
   */
  it('冷笑苦笑不是開心', () => {
    expect(emotionOf('「是嗎」', '他冷笑一聲')).not.toBe('cheerful')
    expect(emotionOf('「算了」', '她苦笑著')).not.toBe('cheerful')
    expect(emotionOf('「隨便你」', '他譏笑道')).not.toBe('cheerful')
  })

  it('怒贏過笑——怒笑是怒', () => {
    expect(emotionOf('「好啊」', '他怒道，笑得發抖')).toBe('angry')
  })

  /**
   * 作者把話說白的時候要聽得懂。
   *
   * 這一句是實測在正文裡逮到的：後面接的台詞只有一個「好」字，被判成
   * cheerful。用歡快的聲音唸出來，整場戲的意思就唸反了。
   */
  it('沒有溫度的笑不是笑', () => {
    expect(emotionOf('「好。」', '只是那笑意，沒有半分溫度。')).not.toBe('cheerful')
    expect(emotionOf('「好。」', '他笑了，笑裡毫無暖意。')).not.toBe('cheerful')
  })

  it('真的高興還是要判得出來', () => {
    expect(emotionOf('「伯伯放心。」', '沈知味接過竹筐，笑得眉眼彎彎。')).toBe('cheerful')
    expect(emotionOf('「錢管事，您點點？」', '她拍了拍手，笑得十分燦爛。')).toBe('cheerful')
  })
})

describe('情緒 → 音色支援的風格', () => {
  const twentyStyles = ['angry', 'sad', 'cheerful', 'gentle', 'calm', 'serious', 'fearful']

  it('有就直接用', () => {
    expect(styleFor({ emotion: 'angry', supported: twentyStyles })).toBe('angry')
  })

  it('沒有就退讓，而且退在同一個方向上', () => {
    expect(styleFor({ emotion: 'angry', supported: ['disgruntled'] })).toBe('disgruntled')
    expect(styleFor({ emotion: 'sad', supported: ['depressed'] })).toBe('depressed')
    // 官話音色沒有 whispering，退到 gentle。
    expect(styleFor({ emotion: 'whispering', supported: twentyStyles })).toBe('gentle')
  })

  /**
   * 退不到就不送。送一個音色不支援的風格，Azure 會**安靜地照平常唸**——
   * 不報錯，所以沒人會知道這個設定沒生效。回 null 至少是誠實的。
   */
  it('退不到就不送', () => {
    expect(styleFor({ emotion: 'angry', supported: ['newscast'] })).toBeNull()
    expect(styleFor({ emotion: 'angry', supported: [] })).toBeNull()
  })

  it('沒有情緒證據時用角色表填的預設風格', () => {
    expect(styleFor({ emotion: null, base: 'serious', supported: twentyStyles })).toBe('serious')
  })

  it('正文的情緒贏過角色的預設風格', () => {
    expect(styleFor({ emotion: 'angry', base: 'gentle', supported: twentyStyles })).toBe('angry')
  })

  it('角色填了這個音色沒有的風格，不送', () => {
    expect(styleFor({ emotion: null, base: 'poetry-reading', supported: twentyStyles })).toBeNull()
  })
})

describe('SSML 裡的 express-as', () => {
  it('風格包在 voice 裡、prosody 外', () => {
    const ssml = ssmlFor([{ text: '「你說什麼」', paragraph: 0, style: 'angry', rate: 1.1 }], {
      locale: 'zh-TW',
      narratorVoice: 'zh-CN-XiaoxiaoNeural',
    })

    const voiceAt = ssml.indexOf('<voice')
    const styleAt = ssml.indexOf('<mstts:express-as')
    const prosodyAt = ssml.indexOf('<prosody')

    expect(voiceAt).toBeLessThan(styleAt)
    expect(styleAt).toBeLessThan(prosodyAt)
    expect(ssml).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"')
    expect(ssml).toContain('</mstts:express-as>')
  })

  /** 標籤交錯的 SSML 是 400，整批白跑。 */
  it('換風格時標籤收得乾淨，數量對得上', () => {
    const ssml = ssmlFor(
      [
        { text: '「你說什麼」', paragraph: 0, style: 'angry' },
        { text: '「算了。」', paragraph: 1, style: 'sad' },
        { text: '他轉身走了。', paragraph: 2 },
      ],
      { locale: 'zh-TW', narratorVoice: 'zh-CN-XiaoxiaoNeural' }
    )

    const opens = ssml.match(/<mstts:express-as/g) ?? []
    const closes = ssml.match(/<\/mstts:express-as>/g) ?? []
    expect(opens).toHaveLength(2)
    expect(closes).toHaveLength(2)

    expect((ssml.match(/<prosody/g) ?? []).length).toBe(
      (ssml.match(/<\/prosody>/g) ?? []).length
    )
    expect((ssml.match(/<voice /g) ?? []).length).toBe((ssml.match(/<\/voice>/g) ?? []).length)
  })

  it('沒有風格就完全不出現 express-as', () => {
    const ssml = ssmlFor([{ text: '他轉身走了。', paragraph: 0 }], {
      locale: 'zh-TW',
      narratorVoice: 'zh-CN-XiaoxiaoNeural',
    })
    expect(ssml).not.toContain('express-as')
  })
})
