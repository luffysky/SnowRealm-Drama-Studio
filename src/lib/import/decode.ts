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

  const best = candidates[0]
  if (best && best.score > 0) {
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
 * 解出來的東西有多像中文。
 *
 * 同一串位元組 Big5 與 GBK 都「解得出來」，差別在解錯的那一個會給出一堆罕用
 * 字與替換字元。所以數常用漢字、扣掉替換字元與私用區。
 */
function scoreChinese(text: string): number {
  let score = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0xfffd) score -= 4 // 替換字元：解錯的訊號
    else if (code >= 0x4e00 && code <= 0x9fff) score += 1 // 常用漢字
    else if (code >= 0x3400 && code <= 0x4dbf) score -= 1 // 擴充 A：多半是解錯
    else if (code >= 0xe000 && code <= 0xf8ff) score -= 2 // 私用區
  }
  return score
}
