'use client'

import { useEffect } from 'react'

/**
 * 把一塊畫面裡的繁體字就地換成簡體 (Z135).
 *
 * 抽出來是因為有兩個地方要用，而且它們必須**行為完全一樣**：整個介面一份，
 * 小說正文一份——後者有自己的切換鍵，跟介面設定分開。兩份各寫一次，遲早會
 * 分岔成「介面轉了正文沒轉」那種讀起來像壞掉的狀態。
 *
 * 為什麼是改 DOM 而不是做 i18n：全專案幾百個元件裡寫死的中文是同一句話的
 * 兩種字形，不是兩種語言。把它們抽成訊息檔是好幾週的工，而且抽完還是同一句
 * 話。這裡轉的是**顯示**，資料庫一個字都沒有動。
 *
 * 之所以安全，是因為只跑一個方向。原始字串是繁體，所以「繁體」是不轉、
 * 「简体」是轉；簡轉繁那個一對多的方向（`干` 可能是乾／幹／干）永遠不會被
 * 執行。
 *
 * 三件讓它不出事的事：
 *
 *  1. **不碰輸入中的文字。** `<input>`、`<textarea>`、`contenteditable`
 *     全部跳過——在編輯器裡打字時把字換掉，等於改了作者正在寫的稿。
 *     下拉選單**不算**輸入中的文字，見 `SKIP_TAGS`。
 *  2. **不碰已經有自己主張的區塊。** `data-script-own` 標記的子樹由它自己
 *     負責（小說正文就是），`data-script-keep` 則是完全不轉（切換鍵本身）。
 *  3. **轉換是等冪的。** 已經是簡體的文字再轉一次還是自己，所以我們自己造成
 *     的 DOM 變動不會讓觀察器無限循環。
 */

/**
 * Tags whose text is not prose and must never be rewritten.
 *
 * `SELECT` **不在這裡面**（Z156）。它本來在，跟 `INPUT`／`TEXTAREA` 放在一
 * 起，但那三個不是同一回事：輸入框裡是使用者正在打的字，而 `<option>` 的文
 * 字是我們寫死的標籤——跟按鈕上的字、表格標題一模一樣的東西。
 *
 * 結果是下拉選單永遠停在繁體。分鏡工作台一頁有七個下拉，於是整頁簡體中間插
 * 著「三文錢的生意」。
 *
 * 轉它是安全的，因為**選項的值來自 `value` 屬性，不是文字**：屬性不是文字
 * 節點，這支程式從頭到尾只碰 `nodeValue`。全專案每一個 `<option>` 都寫了
 * `value=`（查過），所以沒有任何一個選項的值是從它的文字推出來的——而那正是
 * 唯一會讓這件事出錯的情況，因為 HTML 在沒有 `value` 時會拿文字當值。
 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT'])

/**
 * 這個標籤的文字該不該放過。
 *
 * 獨立出來是為了**測得到**：這份判斷沒有 DOM 就驗不了（測試跑在 node 環境，
 * 沒有 jsdom），而「SELECT 又被加回跳過清單」會悄悄地把下拉選單變回繁體——
 * 那種錯沒有人會回報，只會覺得這個軟體很粗糙。
 */
export function isSkippedTag(tagName: string): boolean {
  return SKIP_TAGS.has(tagName.toUpperCase())
}

/** Fast reject: nothing to do for text with no Han characters. */
const HAN = /\p{Script=Han}/u

/**
 * Whether this node's text may be converted.
 *
 * Walks up rather than checking the immediate parent: a `<span>` inside a
 * `contenteditable` is still inside it, and rewriting it would edit somebody's
 * draft out from under them.
 *
 * `stopAt` is the root being converted — the walk stops there, so the reader
 * converting its own prose is not blocked by its own `data-script-own`.
 */
function convertible(node: Node, stopAt: Node): boolean {
  let at: HTMLElement | null = node.parentElement

  while (at) {
    if (SKIP_TAGS.has(at.tagName)) return false
    if (at.isContentEditable) return false
    if (at.dataset.scriptKeep !== undefined) return false
    if (at === stopAt) break
    if (at.dataset.scriptOwn !== undefined) return false
    at = at.parentElement
  }

  return true
}

/**
 * `<optgroup label>` 是屬性，不是文字節點 (Z160).
 *
 * 這支程式從頭到尾只碰 `nodeValue`，所以 Z156 讓 `<option>` 的文字跟著設定
 * 走之後，群組標題還是繁體——簡體模式下那個下拉會變成「群組標題繁體、裡面
 * 的選項簡體」，正好是 Z156 要消滅的那種畫面，只是搬到了標題上。
 *
 * 只處理 `label`：其他屬性（`title`、`placeholder`、`aria-label`）也是同一
 * 類問題，但它們沒有 `<optgroup>` 這種「同一個下拉裡一半轉一半不轉」的刺眼
 * 程度，而且數量大得多。要做就另外做，不要順手塞進來。
 */
function convertLabels(node: Node, root: Node, convert: (text: string) => string): void {
  if (!(node instanceof Element) && !(node instanceof Document)) return

  const groups = node.querySelectorAll('optgroup[label]')
  const all =
    node instanceof Element && node.matches('optgroup[label]')
      ? [node, ...groups]
      : [...groups]

  for (const group of all) {
    const label = group.getAttribute('label')
    if (!label || !HAN.test(label)) continue
    // 從 `<select>` 往上檢查：`data-script-keep` 的子樹一樣不碰。
    if (!convertible(group, root)) continue

    const next = convert(label)
    if (next !== label) group.setAttribute('label', next)
  }
}

export function useScriptConversion(
  /** Recomputed on every run, so a ref that fills in later still works. */
  getRoot: () => Node | null,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let convert: ((text: string) => string) | null = null
    let observer: MutationObserver | null = null
    let queued = 0

    const walk = (node: Node, root: Node) => {
      if (!convert) return

      const iterator = document.createNodeIterator(node, NodeFilter.SHOW_TEXT)
      let text: Node | null

      while ((text = iterator.nextNode())) {
        const value = text.nodeValue
        if (!value || !HAN.test(value)) continue
        if (!convertible(text, root)) continue

        const next = convert(value)
        // Idempotent, so an already-converted node writes nothing and the
        // observer below is not woken by our own work.
        if (next !== value) text.nodeValue = next
      }

      convertLabels(node, root, convert)
    }

    const run = () => {
      const root = getRoot()
      if (root) walk(root, root)
    }

    /*
     * 同一帧的每一筆變動都要處理 (Z160).
     *
     * 本來是「已經排程了就直接 return」，而排程裡只 walk 第一筆帶進來的
     * node——於是一次 MutationObserver callback 帶回 N 筆 record 的時候，
     * **只有第一筆的子樹會被轉，其餘 N−1 筆永遠不會**。
     *
     * 初次掛載有 `run()` 全文掃過所以看不出來；之後新增的內容（對話框、
     * toast、下一頁清單、用戶端導航換頁）全靠 observer，所以一次掛上好幾塊
     * 的畫面會轉一塊、留一塊。
     *
     * 改成把待處理的節點累積起來，一帧處理完。
     */
    const pending = new Set<Node>()

    const schedule = (node: Node) => {
      pending.add(node)
      if (queued) return

      queued = window.requestAnimationFrame(() => {
        queued = 0
        const root = getRoot()
        const batch = [...pending]
        pending.clear()
        if (!root) return
        for (const target of batch) {
          // 期間被移除的節點不用管——轉一個不在畫面上的東西沒有意義。
          if (target.isConnected) walk(target, root)
        }
      })
    }

    void (async () => {
      /*
       * Loaded on demand. The dictionaries are the bulk of this library, and
       * a reader who stays on 繁體 never pays for them.
       */
      const { toSimplified } = await import('@/lib/chinese')
      if (cancelled) return

      convert = toSimplified
      run()

      const root = getRoot()
      if (!root) return

      /*
       * 之後新增的內容也要跟著轉.
       *
       * This is the whole reason for an observer rather than a single pass:
       * almost everything on these pages arrives after the first paint —
       * a dialog, a toast, the next page of a list, a message in the chat.
       * A one-off conversion would leave every one of them in 繁體.
       */
      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') schedule(record.target)
          else for (const added of record.addedNodes) schedule(added)
        }
      })

      observer.observe(root, { subtree: true, childList: true, characterData: true })
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      if (queued) window.cancelAnimationFrame(queued)
    }
  }, [getRoot, enabled])
}
