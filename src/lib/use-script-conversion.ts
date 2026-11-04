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
 *  2. **不碰已經有自己主張的區塊。** `data-script-own` 標記的子樹由它自己
 *     負責（小說正文就是），`data-script-keep` 則是完全不轉（切換鍵本身）。
 *  3. **轉換是等冪的。** 已經是簡體的文字再轉一次還是自己，所以我們自己造成
 *     的 DOM 變動不會讓觀察器無限循環。
 */

/** Tags whose text is not prose and must never be rewritten. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT'])

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
    }

    const run = () => {
      const root = getRoot()
      if (root) walk(root, root)
    }

    const schedule = (node: Node) => {
      if (queued) return
      queued = window.requestAnimationFrame(() => {
        queued = 0
        const root = getRoot()
        if (root) walk(node, root)
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
