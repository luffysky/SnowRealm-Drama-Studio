import { foldForSearch } from '@/lib/chinese'

/**
 * 編輯器搜尋的字串比對 (Z179).
 *
 * 這一支刻意**不碰 TipTap**，跟 `modules.ts` 一樣：比對規則是這個功能最容易
 * 悄悄壞掉的部分（偏移量差一、長度沒對齊、繁簡折錯邊），而那些全都是純字串
 * 運算。放在這裡它們就測得到，不必為了驗一條比對規則去開一顆瀏覽器。
 */

/** 文件裡的一段，用 ProseMirror 的位置表示。 */
export type SearchRange = { from: number; to: number }

export type SearchOptions = {
  /** 繁簡通用：打繁體也找得到簡體原文，反之亦然。 */
  fold: boolean
  caseSensitive: boolean
}

/*
 * 小寫化也會改長度，而那同樣會把偏移量弄歪。
 *
 * `'İ'.toLowerCase()` 是兩個碼元（i + U+0307），`'ẛ'` 也是。這本小說裡大概不
 * 會出現，但「大概不會」不是理由——這一條的代價是一個 Map，而它擋掉的是一種
 * 會砍錯字的錯。
 */
const lowerCache = new Map<string, string>()

function lowerKeepingLength(char: string): string {
  let lowered = lowerCache.get(char)
  if (lowered === undefined) {
    const next = char.toLowerCase()
    lowered = next.length === char.length ? next : char
    lowerCache.set(char, lowered)
  }
  return lowered
}

/**
 * 把一段字折成比對用的形式，而**長度保證不變**。
 *
 * 長度不變是這整件事的地基：相符處的位置是用折疊後字串的偏移量算出來的，然後
 * 直接拿去當原文的位置。差一個字，高亮就標在隔壁，取代就砍到別的字——而兩者
 * 都不會報錯。
 *
 * 不匯出：它是 `matchOffsets` 的實作細節，而測試量的是**結果**（偏移量對不
 * 對），不是這一支的回傳值。匯出一個只有測試在用的函式，等於讓測試決定介面長
 * 什麼樣。
 */
function normaliseForSearch(text: string, options: SearchOptions): string {
  const folded = options.fold ? foldForSearch(text) : text
  if (options.caseSensitive) return folded

  let out = ''
  for (const char of folded) out += lowerKeepingLength(char)
  return out
}

/**
 * 每一個相符處在 `haystack` 裡的起始偏移量。
 *
 * 重疊的不收（`aa` 在 `aaa` 裡算一次，不是兩次），跟使用者按「下一個」的直覺
 * 一致：如果 `aaa` 裡有兩個重疊的 `aa`，全部取代會把中間那個字算兩次。
 *
 * `accept` 讓呼叫端否決一個候選——文件搜尋用它擋掉「位置不連續」的假相符（攤
 * 平字串把圖片、換行跳過了，所以兩段文字會黏在一起）。
 *
 * **被否決的候選不會推進掃描。** 這一行是 Z179 子代理審出來的：原本不論收不
 * 收都往前跳一整個 needle 長度，於是一個被否決的候選會連帶吃掉它後面重疊的那
 * 個真相符。最小例是段落 `a` + 換行 + `aa` 搜 `aa`：攤平成 `aaa`，候選只有
 * offset 0，而它跨換行被否決，於是真正存在的那個 `aa` 永遠看不到——回報 0
 * 筆。不報錯，只是找不到。
 */
export function matchOffsets(
  haystack: string,
  needle: string,
  options: SearchOptions,
  accept?: (offset: number) => boolean
): number[] {
  if (!needle || !haystack) return []

  const target = normaliseForSearch(needle, options)
  const folded = normaliseForSearch(haystack, options)
  if (!target) return []

  const offsets: number[] = []
  let at = folded.indexOf(target)
  while (at !== -1) {
    if (accept && !accept(at)) {
      at = folded.indexOf(target, at + 1)
      continue
    }
    offsets.push(at)
    at = folded.indexOf(target, at + target.length)
  }
  return offsets
}
