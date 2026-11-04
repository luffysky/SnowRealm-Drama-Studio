/**
 * 情緒風格 —— 讓生氣的台詞真的用生氣的聲音唸 (Z140).
 *
 * `characters.voiceStyle` 這個欄位從一開始就在，但**沒有任何產生音訊的程式
 * 讀過它**。它只出現在型別定義跟更新欄位清單裡——是一個寫得進去、看得到、
 * 卻完全不起作用的設定。這個檔案就是把它接起來。
 *
 * ## 跟語氣有什麼不同
 *
 * `narration.ts` 的 `toneOf()` 已經在分語氣了，但它只調**語速與音高**：
 * 喊的快一點高一點，低聲的慢一點低一點。那是物理，不是演繹——音高調高的
 * 平靜句子聽起來還是平靜的，只是比較高。
 *
 * Azure 的 `<mstts:express-as>` 不一樣，它換的是**演法**。所以這裡不重用
 * `toneOf` 的結果，而是另外看一次正文。
 *
 * ## 為什麼另看一次：風格是一個斷言
 *
 * 語氣猜錯的代價是「這句話聽起來有點高」。風格猜錯的代價是「這句話聽起來
 * 在生氣」——那是對這個場景說了一件假話，比平淡地唸過去糟糕得多。
 *
 * 所以 `emotionOf()` 的標準比 `toneOf()` **嚴格**：只有正文把情緒**寫出來**
 * 才採用。「他說」沒有情緒，「他怒道」才有。沒有證據就回 `null`，然後退回
 * 角色自己的預設風格——那是人填的，不是猜的。
 *
 * 純函式，沒有網路。
 */

export const EMOTIONS = [
  'angry',
  'sad',
  'cheerful',
  'gentle',
  'whispering',
  'fearful',
  'serious',
] as const

export type Emotion = (typeof EMOTIONS)[number]

export const EMOTION_LABEL: Record<Emotion, string> = {
  angry: '怒',
  sad: '悲',
  cheerful: '喜',
  gentle: '柔',
  whispering: '耳語',
  fearful: '懼',
  serious: '肅',
}

/* -------------------------------------------------------------------------- */
/* 從正文讀情緒                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 不算高興的笑。
 *
 * 「冷笑」「苦笑」「譏笑」「乾笑」在中文小說裡**全部不是開心**，而且它們都
 * 含「笑」。先排除這些再找「笑」，否則一句譏諷會用歡快的聲音唸出來——那正是
 * 風格猜錯最難聽的樣子。
 */
const BITTER_LAUGH =
  /冷笑|苦笑|譏笑|嘲笑|乾笑|慘笑|皮笑|訕笑|強笑|嗤笑|哄笑|鬨笑|笑不出|笑話/

/**
 * 寫明了那個笑不暖的句子。
 *
 * 實測逮到的那一句是「只是那笑意，**沒有半分溫度**」——後面接的台詞只有
 * 一個「好」字，被判成 cheerful。作者已經把話說到這麼白了，用歡快的聲音
 * 唸出來就是把整場戲的意思唸反。
 *
 * 跟 `BITTER_LAUGH` 分開一條，因為它比對的是**對笑的描述**而不是笑的名字，
 * 而這部小說裡這種寫法比「冷笑」還多。
 */
const COLD_SMILE =
  /笑[^，。！？」]{0,6}(沒有|毫無|不帶|全無)[^，。！？」]{0,4}(溫度|溫暖|暖意|笑意)|(沒有|毫無|不帶)[^，。！？」]{0,4}溫度/

/**
 * 每一種情緒的證據。
 *
 * 全部是**正文寫出來的情緒詞**，不是從標點推的。順序有意義：先比對的贏，
 * 而排前面的是講得比較具體的。
 */
const EVIDENCE: { emotion: Emotion; pattern: RegExp }[] = [
  // 耳語排在「柔」前面：悄聲比輕柔具體。
  { emotion: 'whispering', pattern: /悄聲|耳語|喃喃|呢喃|壓低[了]?[聲嗓]|低[聲語]道|小聲道/ },
  { emotion: 'angry', pattern: /怒[道喝吼斥聲視]|厲聲|咆哮|怒火|發火|氣得|惱[怒火]|斥[道責]|喝斥|吼[道叫]/ },
  { emotion: 'fearful', pattern: /駭[然得]|驚恐|恐懼|害怕|怕得|顫[抖聲]|哆嗦|慌[亂張得]|瑟縮|心驚/ },
  { emotion: 'sad', pattern: /哭|泣|淚|悲|哀|嘆[了一息道]|難過|心[酸疼]|酸[楚澀]|哽/ },
  { emotion: 'serious', pattern: /沉聲|正色|肅[然容]|鄭重|冷[聲冰]|一字一句|板著臉/ },
  { emotion: 'gentle', pattern: /柔[聲和]|溫[聲柔和]|和[聲緩]|輕聲|緩[聲緩道]/ },
  { emotion: 'cheerful', pattern: /笑|喜|樂|欣|興奮|雀躍|咧[開著]?嘴|眉開/ },
]

/**
 * 正文寫出來的情緒，沒寫就是 `null`。
 *
 * `context` 是整段，`text` 是要唸的那一小塊——情緒詞通常在「他怒道：」裡，
 * 而那句話本身只有引號內的內容，所以兩個都要看。
 */
export function emotionOf(text: string, context = ''): Emotion | null {
  const both = `${context}${text}`

  for (const row of EVIDENCE) {
    if (row.emotion === 'cheerful' && (BITTER_LAUGH.test(both) || COLD_SMILE.test(both))) continue
    if (row.pattern.test(both)) return row.emotion
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* 情緒 → Azure 的風格名字                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 一種情緒，按優先順序排的候選風格。
 *
 * 要候選清單是因為**每個音色支援的風格不一樣**：曉曉有二十種，雲希十二種，
 * 台灣的三個一種都沒有。送一個音色不支援的風格，Azure 會安靜地照平常唸——
 * 不報錯，所以你不會知道這個設定沒生效。
 *
 * 所以這裡只送**那個音色真的有**的，而且退讓是有方向的：怒退到不悅，悲退到
 * 低落，都還在同一個方向上。退不到就不送——平淡地唸過去，比用錯的情緒唸
 * 誠實。
 */
export const STYLE_CANDIDATES: Record<Emotion, string[]> = {
  angry: ['angry', 'disgruntled', 'unfriendly'],
  sad: ['sad', 'depressed', 'gentle'],
  cheerful: ['cheerful', 'excited', 'friendly'],
  gentle: ['gentle', 'affectionate', 'calm'],
  whispering: ['whispering', 'gentle', 'calm'],
  fearful: ['fearful', 'terrified', 'sad'],
  serious: ['serious', 'calm', 'narration-relaxed'],
}

/**
 * 這一句要用哪個風格，或者不用。
 *
 * 兩個來源，正文贏過設定：
 *
 *  - **正文寫出來的情緒** —— 這一句的證據。「他怒道」就是怒，不管這個角色
 *    平常怎麼說話。
 *  - **角色自己的預設風格**（`characters.voiceStyle`）—— 人填的，當這一句
 *    沒有情緒證據時用。
 *
 * 兩個都沒有、或者音色不支援，就回 `null`：不包 `<mstts:express-as>`。
 */
export function styleFor(input: {
  emotion: Emotion | null
  /** `characters.voiceStyle`，可以是 Azure 的風格名或空的。 */
  base?: string | null
  /** 這個音色支援的風格，從 Azure 的音色清單來的。 */
  supported: readonly string[]
}): string | null {
  const available = new Set(input.supported.map((style) => style.trim()).filter(Boolean))
  if (available.size === 0) return null

  if (input.emotion) {
    for (const candidate of STYLE_CANDIDATES[input.emotion]) {
      if (available.has(candidate)) return candidate
    }
  }

  const base = (input.base ?? '').trim()
  if (base && available.has(base)) return base

  return null
}
