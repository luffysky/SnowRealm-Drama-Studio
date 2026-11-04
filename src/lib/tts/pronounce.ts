/**
 * 破音字 (Z140).
 *
 * 使用者的耳朵抓到三個：「還錢」唸成 ㄏㄞˊ 錢、「頓了頓」第二個頓唸成
 * ㄉㄨˊ（那是「冒頓」的讀音，Azure 真的有收）。這類錯誤**不會報錯**，只會
 * 繼續唸錯，而且要聽完十五分鐘才會遇到一次。
 *
 * ## 怎麼改
 *
 * SSML 的 `<phoneme>`。但它的行為是量過的，不是查來的——下面這張表來自
 * `scripts/probe-phoneme.ts`，39 個官話音色逐一送一個六音節的替代讀音，
 * 看**位元組長度有沒有變**：
 *
 *     zh-TW-*     注音     ㄏㄨㄢˊ       3 個音色，2 個照唸
 *     zh-CN-*     拼音     huan 2       36 個音色，33 個照唸
 *     zh-HK / yue-* / wuu-*             一律 400，不支援
 *     en-US-*Multilingual               一律 400，不支援
 *
 * 三件事是測出來的，不是猜的：
 *
 *  1. **聲調前面要有空格。** `ph="huan2"` 是 400，`ph="huan 2"` 是 200。
 *     上一輪就是漏了這個空格，才得出「zh-CN 不支援」那個錯結論。
 *  2. **注音與拼音不能互換。** 拼音送給 zh-TW 音色是 400，注音送給 zh-CN
 *     音色也是 400。而一次 400 會讓整個批次白跑。
 *  3. **有四個音色收下來卻忽略。** 回 200，長度卻跟沒加一樣。那比拒絕難
 *     發現得多，所以記在 `IGNORES_PHONEME` 裡——選音色的時候要講出來。
 *
 * ## 為什麼是「詞」而不是「字」
 *
 * 「還」在這部小說裡出現 160 次以上，其中「還有」「還是」「還沒」是 ㄏㄞˊ
 * 而且唸對了。按字改會把對的一起改錯。所以每一條規則都綁在**詞**上，而且
 * 只改詞裡指定的那一個位置。
 *
 * 純函式，沒有網路。
 */

/** 一個字該怎麼唸，兩種拼寫各一份。 */
export type Reading = {
  /** 注音，給 zh-TW 音色。聲調記號直接接在後面。 */
  bopomofo: string
  /** 拼音，給 zh-CN 音色。**聲調數字前面有一個空格**，那是 Azure 要的。 */
  pinyin: string
}

export type LexiconEntry = {
  /** 出現這個詞的時候才動。 */
  word: string
  /** 詞裡要改的位置（0 起算）與讀音。 */
  marks: { at: number; reading: Reading }[]
  /** 為什麼。給之後看的人，也給自己加規則的人照著寫。 */
  why: string
}

/* -------------------------------------------------------------------------- */
/* 讀音                                                                        */
/* -------------------------------------------------------------------------- */

const HUAN2: Reading = { bopomofo: 'ㄏㄨㄢˊ', pinyin: 'huan 2' }
const DUN4: Reading = { bopomofo: 'ㄉㄨㄣˋ', pinyin: 'dun 4' }
const CHENG2: Reading = { bopomofo: 'ㄔㄥˊ', pinyin: 'cheng 2' }
const SHAO4: Reading = { bopomofo: 'ㄕㄠˋ', pinyin: 'shao 4' }
const HANG2: Reading = { bopomofo: 'ㄏㄤˊ', pinyin: 'hang 2' }
const LIANG2: Reading = { bopomofo: 'ㄌㄧㄤˊ', pinyin: 'liang 2' }
const FEN4: Reading = { bopomofo: 'ㄈㄣˋ', pinyin: 'fen 4' }
const PIAN2: Reading = { bopomofo: 'ㄆㄧㄢˊ', pinyin: 'pian 2' }
const HUO2: Reading = { bopomofo: 'ㄏㄨㄛˊ', pinyin: 'huo 2' }
const SHU3: Reading = { bopomofo: 'ㄕㄨˇ', pinyin: 'shu 3' }

/** 一個字一條規則的簡寫。 */
function one(word: string, at: number, reading: Reading, why: string): LexiconEntry {
  return { word, marks: [{ at, reading }], why }
}

/* -------------------------------------------------------------------------- */
/* 字典                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 規則表。
 *
 * **只收有根據的。** 根據分兩種：使用者聽出來的，以及這部小說的正文裡真的
 * 有、而且正確讀音是少數讀音的詞（`scripts/probe-stars.ts` 掃出來的）。
 *
 * 刻意不收「重新」「為了」「因為」這類：它們是最高頻的詞，模型幾乎不會錯，
 * 而每多一條規則就多一處可能把對的改錯。寧可少收。
 */
export const LEXICON: LexiconEntry[] = [
  /* ---- 使用者聽出來的 ---- */
  one('還錢', 0, HUAN2, '歸還的還是 ㄏㄨㄢˊ；聽到唸成 ㄏㄞˊ 錢'),
  one('還給', 0, HUAN2, '歸還的還是 ㄏㄨㄢˊ'),
  one('還清', 0, HUAN2, '歸還的還是 ㄏㄨㄢˊ'),
  one('還債', 0, HUAN2, '歸還的還是 ㄏㄨㄢˊ'),
  one('還回', 0, HUAN2, '歸還的還是 ㄏㄨㄢˊ'),
  one('歸還', 1, HUAN2, '歸還的還是 ㄏㄨㄢˊ'),
  one('償還', 1, HUAN2, '償還的還是 ㄏㄨㄢˊ'),
  one('還你', 0, HUAN2, '「還你」是歸還，不是「還有你」'),
  one('還我', 0, HUAN2, '「還我」是歸還，不是「還有我」'),
  {
    word: '頓了頓',
    marks: [
      { at: 0, reading: DUN4 },
      { at: 2, reading: DUN4 },
    ],
    why: '「頓」另一個讀音 ㄉㄨˊ 只用在「冒頓」這個人名；聽到第二個頓唸成 ㄉㄨˊ',
  },
  one('停頓', 1, DUN4, '頓一律 ㄉㄨㄣˋ，除了人名「冒頓」'),
  one('頓時', 0, DUN4, '頓一律 ㄉㄨㄣˋ，除了人名「冒頓」'),

  /* ---- 這是一部廚子的小說：盛、量、和都是動詞 ---- */
  one('盛飯', 0, CHENG2, '把飯裝進碗裡是 ㄔㄥˊ，不是 ㄕㄥˋ'),
  one('盛湯', 0, CHENG2, '把湯裝進碗裡是 ㄔㄥˊ'),
  one('盛麵', 0, CHENG2, '把麵裝進碗裡是 ㄔㄥˊ'),
  one('盛起', 0, CHENG2, '盛起來是 ㄔㄥˊ'),
  one('盛進', 0, CHENG2, '盛進去是 ㄔㄥˊ'),
  one('盛放', 0, CHENG2, '盛放是 ㄔㄥˊ'),
  one('盛好', 0, CHENG2, '盛好是 ㄔㄥˊ'),
  one('盛著', 0, CHENG2, '盛著是 ㄔㄥˊ'),
  one('盛了', 0, CHENG2, '盛了是 ㄔㄥˊ'),
  one('量鹽', 0, LIANG2, '動手量是 ㄌㄧㄤˊ；ㄌㄧㄤˋ 是份量'),
  one('量油', 0, LIANG2, '動手量是 ㄌㄧㄤˊ'),
  one('量麵', 0, LIANG2, '動手量是 ㄌㄧㄤˊ'),
  one('量水', 0, LIANG2, '動手量是 ㄌㄧㄤˊ'),
  one('量薑', 0, LIANG2, '動手量是 ㄌㄧㄤˊ'),
  one('和麵', 0, HUO2, '把麵粉和水揉在一起是 ㄏㄨㄛˊ'),
  one('分量', 0, FEN4, '份量的分是 ㄈㄣˋ'),

  /* ---- 這是一部古代的小說 ---- */
  one('少東家', 0, SHAO4, '少東家的少是 ㄕㄠˋ，不是 ㄕㄠˇ'),
  one('少東', 0, SHAO4, '少東的少是 ㄕㄠˋ'),
  one('少爺', 0, SHAO4, '少爺的少是 ㄕㄠˋ'),
  one('行當', 0, HANG2, '這一行的行是 ㄏㄤˊ'),
  one('一行字', 1, HANG2, '一行字的行是 ㄏㄤˊ'),
  one('便宜', 0, PIAN2, '便宜的便是 ㄆㄧㄢˊ'),
  one('數錢', 0, SHU3, '點數是 ㄕㄨˇ；ㄕㄨˋ 是數目'),
]

/* -------------------------------------------------------------------------- */
/* 音色支不支援                                                                */
/* -------------------------------------------------------------------------- */

export type PhonemeSpelling = 'bopomofo' | 'pinyin' | 'none'

/**
 * 收下來卻忽略的音色。
 *
 * 回 200，長度卻跟沒加一樣——照 `scripts/probe-phoneme2.ts` 量到的。記在
 * 這裡是為了讓選音色的介面講得出來：挑了這幾個，破音字就改不動。
 */
export const IGNORES_PHONEME = new Set([
  'zh-TW-HsiaoYuNeural',
  'zh-CN-YunyeNeural',
  'zh-CN-XiaoshuangMultilingualNeural',
  'zh-CN-XiaoyuMultilingualNeural',
])

/**
 * 這個音色吃哪一種拼寫。
 *
 * 看**音色的 locale**，不是文件的 `xml:lang`——兩者不一致時是音色說話。
 * 這也是量過的：`xml:lang="zh-CN"` 的文件配 zh-TW 音色，照樣只收注音。
 */
export function phonemeSpelling(voiceId: string): PhonemeSpelling {
  const id = voiceId.trim()
  if (/^zh-TW-/i.test(id)) return 'bopomofo'
  if (/^zh-CN-/i.test(id)) return 'pinyin'
  // 粵語、吳語、多語言：實測一律 400。
  return 'none'
}

/** 這個音色改得動破音字嗎——收下來還忽略的不算。 */
export function canCorrect(voiceId: string): boolean {
  return phonemeSpelling(voiceId) !== 'none' && !IGNORES_PHONEME.has(voiceId.trim())
}

/** 這個音色要的拼寫，從讀音裡挑一份出來。 */
export function spell(reading: Reading, voiceId: string): string | null {
  switch (phonemeSpelling(voiceId)) {
    case 'bopomofo':
      return reading.bopomofo
    case 'pinyin':
      return reading.pinyin
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/* 套到文字上                                                                  */
/* -------------------------------------------------------------------------- */

export type Segment = {
  text: string
  /** 有讀音就要包 `<phoneme>`；沒有就是普通文字。 */
  reading?: Reading
  /** 哪一條規則造成的，為了說明得出來。 */
  why?: string
}

/**
 * 把一段文字切成「要標讀音的字」與「其餘」。
 *
 * 長的詞先比對，所以「少東家」會贏過「少東」——短的先贏會在「少東家」裡
 * 標到「少東」然後把「家」留在外面，標是標對了，但規則的意圖沒表達完整。
 *
 * 一個字只標一次。規則重疊時先到先得，而因為是長詞優先，先到的就是講得
 * 比較具體的那一條。
 */
export function markReadings(text: string, lexicon: LexiconEntry[] = LEXICON): Segment[] {
  if (!text) return []

  /** 字的位置 → 該唸什麼。 */
  const marked = new Map<number, { reading: Reading; why: string }>()

  const byLength = [...lexicon].sort((a, b) => b.word.length - a.word.length)

  for (const entry of byLength) {
    if (!entry.word) continue

    let from = 0
    for (;;) {
      const at = text.indexOf(entry.word, from)
      if (at < 0) break
      from = at + 1

      for (const mark of entry.marks) {
        // 超出詞的範圍是規則寫錯了，不是文字的問題——忽略，不要標到別的字。
        if (mark.at < 0 || mark.at >= entry.word.length) continue
        const index = at + mark.at
        if (marked.has(index)) continue
        marked.set(index, { reading: mark.reading, why: entry.why })
      }
    }
  }

  if (marked.size === 0) return [{ text }]

  const out: Segment[] = []
  let buffer = ''

  const flush = () => {
    if (buffer) out.push({ text: buffer })
    buffer = ''
  }

  for (let i = 0; i < text.length; i += 1) {
    const mark = marked.get(i)
    if (mark) {
      flush()
      out.push({ text: text[i]!, reading: mark.reading, why: mark.why })
      continue
    }
    buffer += text[i]
  }

  flush()
  return out
}
