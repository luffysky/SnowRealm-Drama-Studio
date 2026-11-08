/**
 * 位元組 → 文字，而且**不要變成亂碼** (Z185).
 *
 * ## 為什麼需要這一層
 *
 * `File.text()` 一律當 UTF-8 解。而中文 Windows 上的 Excel「另存 CSV」預設寫
 * 的是 **Big5（繁中）或 GBK（簡中）**，不是 UTF-8——那是這整個功能最常見的一
 * 種壞法，而且它不報錯：檔案讀得進來，每一格都是「�」。
 *
 * 更糟的是它會**過得了驗證**：亂碼是合法的字串，所以匯入會成功，然後兩百列
 * 問號進資料庫。
 *
 * ## 怎麼判
 *
 * 1. **有 BOM 就信它。** UTF-8、UTF-16 LE/BE 的 BOM 都是明確的宣告。
 * 2. **嚴格 UTF-8 解得過就是 UTF-8。** `fatal: true` 會在遇到不合法的序列時
 *    丟錯，而 Big5／GBK 的雙位元組幾乎一定會踩到——實測 `一二` 的 Big5 編碼
 *    就過不了。
 * 3. **解不過才猜中文編碼。** Big5 與 GBK 都試，取**能解出比較多漢字**的那
 *    一個：同一串位元組兩邊都「解得出東西」，但錯的那一個會解出一堆罕用字。
 * 4. 還是不行就退回 UTF-8 的寬鬆模式，並且**講出來**——帶著問號的內容總比什
 *    麼都不給好，但人要知道。
 *
 * 不猜日文與韓文：這間工作室的稿子不會是那些，而多一個候選就多一次猜錯的機
 * 會。真的需要的時候再加。
 */

export type DecodeResult = {
  text: string
  encoding: string
  /** 不是 UTF-8 時講一句，介面要顯示。 */
  note: string | null
}


export function decodeBytes(bytes: Uint8Array): DecodeResult {
  if (bytes.length === 0) return { text: '', encoding: 'utf-8', note: null }

  /* ---- 1. BOM ---------------------------------------------------------- */
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decode('utf-8', bytes.subarray(3)), encoding: 'utf-8 (BOM)', note: null }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: decode('utf-16le', bytes.subarray(2)),
      encoding: 'utf-16le',
      note: 'UTF-16 讀進來了，存成 UTF-8 會小一半。',
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: decode('utf-16be', bytes.subarray(2)),
      encoding: 'utf-16be',
      note: 'UTF-16 讀進來了，存成 UTF-8 會小一半。',
    }
  }

  /* ---- 2. 嚴格 UTF-8 ---------------------------------------------------- */
  const strict = tryDecode('utf-8', bytes, true)
  if (strict !== null) return { text: strict, encoding: 'utf-8', note: null }

  /* ---- 3. 中文編碼 ------------------------------------------------------ */
  const candidates: { encoding: string; text: string; score: number }[] = []
  for (const encoding of ['big5', 'gb18030'] as const) {
    const text = tryDecode(encoding, bytes, false)
    if (text === null) continue
    candidates.push({ encoding, text, score: scoreChinese(text) })
  }
  candidates.sort((a, b) => b.score - a.score)

  /*
   * 還是平分的話，**不要默默選第一個**。
   *
   * 穩定排序會讓先推入的那一個永遠贏，而那是一個沒有根據的偏好。分不出來就
   * 照 UTF-8 的寬鬆模式走，並且講出來——一個「我認不出來」比一個猜錯的答案
   * 誠實。
   */
  const best = candidates[0]
  const tied = candidates.length > 1 && candidates[1]!.score === best?.score
  if (best && best.score > 0 && !tied) {
    return {
      text: best.text,
      encoding: best.encoding,
      note: `這個檔案不是 UTF-8，當成 ${best.encoding === 'big5' ? 'Big5' : 'GBK'} 讀。看起來不對的話，請在 Excel 另存成「CSV UTF-8」再試。`,
    }
  }

  /* ---- 4. 放棄，但要講 -------------------------------------------------- */
  return {
    text: decode('utf-8', bytes),
    encoding: 'utf-8 (replacement)',
    note: '這個檔案的編碼認不出來，裡面可能有亂碼。請在 Excel 另存成「CSV UTF-8」再試一次。',
  }
}

/* -------------------------------------------------------------------------- */

function decode(encoding: string, bytes: Uint8Array): string {
  return new TextDecoder(encoding).decode(bytes)
}

function tryDecode(encoding: string, bytes: Uint8Array, fatal: boolean): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 解出來的東西有多像**真的中文**。
 *
 * ## 為什麼不能只數漢字
 *
 * 同一串位元組 Big5 與 GBK 都解得出東西，而**解錯的那一個落點也還在常用漢字
 * 區**——一列簡體分鏡被 Big5 誤解之後是「賒醱鏡扴」，每一個字都算 +1。實測兩
 * 邊都是 23 分，而平分時穩定排序讓先推入的 Big5 永遠贏，於是簡體 Windows 的
 * Excel 存出來的 CSV **一律被判成 Big5**，整張表亂碼 (Z190)。
 *
 * ## 改成看「常不常用」
 *
 * 解對的中文裡，高頻字（的一是不了在人有我他⋯⋯）佔很大的比例；解錯的那一
 * 串雖然也都是漢字，但幾乎全是罕用字。所以高頻字加重算，而其餘漢字只給很小
 * 的分數。標點與數字也算——`，。「」` 這些在解錯時幾乎不會出現。
 */
const COMMON = new Set(
  '的一是不了在人有我他這個們中來上大為和國地到以說時要就出會可也你對生能而子那得於著下自之年過發後作裡用道行所然家種事成方多經麼去法學如都同現當沒動面起看定天分還進好小部其些主樣理心她本前開但因只從想實日軍者意無力它與長把機十民第公此已工使情明性知全三又關點正業外將兩高間由問很最重並物手應戰向頭文體政美相見被利什二等產或新己制身果加西斯月話合回特代內信表化老給世位次度門任常先海通教兒原東聲提立及比員解水名真論處走義各入幾口認條平系氣題活爾更別打女變四神總何電數安少報才結反受目太量再感建務做接必場件計管期市直德資命山金指克許統區保至隊形社便空決治展馬科司五基眼書非則聽白卻界達光放強即像難且權思王象完設式色路記南品住告類求據程北邊死張該交規萬取拉格望覺術領共確傳師觀清今切院讓識候帶導爭運笑飛風步改收根乾造言聯持組每濟車親極林服快辦議往元英士證近失轉夫令準布始怎呢存未遠叫台單影具羅字愛擊流備兵連調深商算質團集百需價花黨華城石級整府離況亞請技際約示復病息究線似官火斷精滿支視消越器容照須九增研寫稱企八功吧301010'
    .split('')
)

function scoreChinese(text: string): number {
  let score = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0

    if (code === 0xfffd) {
      score -= 8 // 替換字元：解錯的硬訊號
      continue
    }
    if (COMMON.has(char)) {
      score += 6 // 高頻字：解對了才會有這麼多
      continue
    }
    if (code >= 0x4e00 && code <= 0x9fff) score += 1 // 其餘漢字：解錯時也會有
    else if (code >= 0x3400 && code <= 0x4dbf) score -= 3 // 擴充 A：幾乎一定是解錯
    else if (code >= 0xe000 && code <= 0xf8ff) score -= 4 // 私用區
    else if ('，。、；：「」『』（）！？—…'.includes(char)) score += 4 // 中文標點
  }
  return score
}
