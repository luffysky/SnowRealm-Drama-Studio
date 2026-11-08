'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ScriptPreference } from '@/lib/chinese'

/**
 * 把一塊畫面裡的字就地換成讀者要的字形 (Z135，方向在 Z172 補齊).
 *
 * 為什麼是改 DOM 而不是做 i18n：全專案幾百個元件裡寫死的中文是同一句話的
 * 兩種字形，不是兩種語言。把它們抽成訊息檔是好幾週的工，而且抽完還是同一句
 * 話。這裡轉的是**顯示**，資料庫一個字都沒有動。
 *
 * ## 兩個方向都要跑，而原本只跑一個
 *
 * 這一支原本寫死 `toSimplified`，理由是「原始字串是繁體，所以繁體是不轉、
 * 简体是轉」。那句話對**我們寫死的介面字串**成立，對**資料庫裡的東西不成
 * 立**——稿子是暖寶用簡體寫的。
 *
 * 畫面上絕大多數的中文不是寫死的標籤：場次內容、分鏡描述、角色小傳、搜尋結
 * 果、聊天訊息，全都是從資料庫來的簡體。只跑繁 → 簡的話，選「繁體」只是把轉
 * 換關掉，於是**整個介面停在簡體**，而那正是使用者看到的症狀。
 *
 * 所以方向改成由偏好設定決定，而兩邊都走 `convertScript`——簡 → 繁 的那道防
 * 護（繁體獨有字就別碰）因此只有一份，不會只有一半的呼叫端有。
 *
 * ## 代價量過了，而我第一次估錯
 *
 * 把 src/ 裡 3,630 段含漢字的字串跑一遍：**無防護會改寫 42 段，有防護 10
 * 段。** 我原本以為是「幾百段降到個位數」，不是。
 *
 * （「3,630 段**介面文字**」是我第一版的寫法，而那個標籤不對：那個掃法連 AI 提
 * 示詞與正規表示式字面值都算進去了，它們永遠不會變成 DOM 文字節點。所以可見
 * 的代價比這個數字小。）
 *
 * 而要緊的不是數量，是防護擋下來的那 32 段裡**有真的錯字**：`儀表板` 會變成
 * `儀錶板`、`只影響` 變成 `隻影響`、`說明了` 變成 `說明瞭`、`游標` 變成
 * `遊標`。那不是「比較正式的寫法」，是沒有人會這樣寫的字。
 *
 * 這些錯**不是轉換器的毛病**。餵它真的簡體，它答得對（`仪表板` → `儀表板`、
 * `说明了` → `說明了`、`游标` → `游標`）。錯是來自把**已經是繁體**的字再餵一
 * 次 cn→tw，於是 OpenCC 的台灣詞組層把一個本來就對的字「校正」成另一個。那正
 * 是防護唯一要擋的事。
 *
 * 剩下那 10 段，照實拆（第一版我把它們全算成「短標籤」，而一半不是）：
 *
 *   - `问`／`叹`／`应`：真簡體，本來就該轉——但它們是
 *     `narration.ts`／`tts/style.ts` 的 **regex 交替式**，不會進 DOM。
 *   - `哄笑`／`酸疼`：同樣是 regex，不是標籤。
 *   - `简体`：繁簡切換鍵上的字。它標了 `data-script-keep` 所以 DOM 這一支不碰
 *     它——那是唯一一個會讓畫面自我矛盾的（兩顆按鈕都寫繁體）。
 *   - `至少要有一台伺服器`：一整句提示，不是短標籤。
 *   - `台`／`加一台`／`管弦`：真的會在畫面上被改寫的三段
 *     （`臺`／`加一臺`／`管絃`）。
 *
 * **而 src/ 不是全部。** 使用者自己打進資料庫的繁體短字串（素材名、標籤、角色
 * 暱稱）也會被這個方向掃過，而它們沒有任何靜態掃描看得到：`熏香` 會顯示成
 * `薰香`、`解雇` 會顯示成 `解僱`。資料沒有變（規則是「只在顯示時轉」），但畫
 * 面上是另一個字。這是這個做法的已知代價，不是可以靠測試消滅的東西。
 *
 * **不加例外字表**：剩下那幾段還是看得懂，而一張「這幾個字別轉」的表會跟著
 * OpenCC 的詞典一起漂移，然後沒有人記得它為什麼在那裡。換轉換器目標字形
 * 也不行——量過了，`to: 't'` 多出 `人群`→`人羣`，`to: 'hk'` 多出 `說明了`→
 * `説明了`，兩個都更糟。
 *
 * 以上每一條在 `tests/chinese.test.ts` 的「介面寫死的繁體標籤（Z172）」裡都有
 * 一條斷言守著，包括「無防護會壞成什麼樣」——只測「有防護不動」的話，防護拿
 * 掉它還是綠的。
 *
 * 三件讓它不出事的事：
 *
 *  1. **不碰輸入中的文字。** `<input>`、`<textarea>`、`contenteditable`
 *     全部跳過——在編輯器裡打字時把字換掉，等於改了作者正在寫的稿。
 *     下拉選單**不算**輸入中的文字，見 `SKIP_TAGS`。
 *  2. **不碰已經有自己主張的區塊。** `data-script-own` 標記的子樹由它自己
 *     負責（小說正文就是），`data-script-keep` 則是完全不轉（切換鍵本身）。
 *  3. **轉換是等冪的。** 已經是簡體的文字再轉一次還是自己；簡 → 繁 那邊，轉
 *     完的結果帶著繁體獨有字，所以防護會讓第二次變成零動作。兩個方向都收
 *     斂，我們自己造成的 DOM 變動不會讓觀察器無限循環。
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
  /**
   * 要轉成哪一種字形。`original` 是不轉 (Z172).
   *
   * 本來是 `enabled: boolean`，而那個布林的意思是「要不要轉成簡體」——方向
   * 寫死在裡面。方向搬到呼叫端之後，「繁體」才有辦法是一次真的轉換而不是把
   * 功能關掉。
   */
  preference: ScriptPreference
): void {
  useEffect(() => {
    if (preference === 'original') return

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

    /*
     * 失敗要收，不然轉換會靜默地永遠不發生 (Z174).
     *
     * 這個 IIFE 原本沒有 catch。`import()` 失敗（部署之後舊 chunk 失效是最
     * 常見的原因）會變成一個 unhandled rejection，而 `convert` 停在 null、
     * MutationObserver 連掛都沒掛上——畫面就永遠停在原本的字形，沒有任何錯
     * 誤訊息。那是最難追的那一種壞法：看起來像「這個設定沒有作用」。
     */
    void (async () => {
      /*
       * Loaded on demand — but no longer conditionally (Z174).
       *
       * 這裡原本寫「停在繁體的讀者不用付字典的錢」。Z172 之後繁體也會轉，所
       * 以兩個方向都要字典；而且 `ScriptProvider` 在模組最上層就 import 了同
       * 一個 chunk（給 `fold` 用），所以 studio 的每一頁本來就已經載過它。
       * 留著動態 import 是為了不把字典塞進主 bundle，不是為了讓某一種設定免
       * 費。
       */
      const { convertScript } = await import('@/lib/chinese')
      if (cancelled) return

      // 兩個方向都走同一支，簡 → 繁 的防護才只有一份 (Z172).
      convert = (text: string) => convertScript(text, preference)
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
    })().catch((error: unknown) => {
      // 收下來並說出來。靜默失敗會被當成「這個功能壞了」，而這裡知道原因。
      console.error('[繁簡] 字典載入失敗，顯示維持原本的字形', error)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      if (queued) window.cancelAnimationFrame(queued)
    }
  }, [getRoot, preference])
}

type ChineseModule = typeof import('@/lib/chinese')

/*
 * 字典載一次就好，而且是整個 app 共用一份。
 *
 * 放在模組層而不是元件狀態裡，是為了讓 `useSyncExternalStore` 讀得到——
 * 在 effect 裡 `setState` 是這個專案 lint 擋下來的事
 * （`react-hooks/set-state-in-effect`），而 `ScriptProvider` 讀偏好設定用的
 * 也是同一個 hook。
 */
let chinese: ChineseModule | null = null
let loading = false
const listeners = new Set<() => void>()

/*
 * 失敗要把旗標放回去 (Z174).
 *
 * 原本是 `loading = true` 之後沒有 catch：import 失敗的話 `loading` 永遠是
 * true、`chinese` 永遠是 null，於是這個 `if` 會把**之後每一次呼叫都擋掉**
 * ——沒有重試、沒有通知、沒有任何可見的錯誤，閱讀器就永遠回原文。
 *
 * 放回 false 讓下一次掛載（換一章、重開閱讀器）可以再試一次。這不是重試迴
 * 圈：它只在有元件訂閱的時候才跑。
 */
function loadChinese(): void {
  if (chinese || loading) return
  loading = true
  void import('@/lib/chinese')
    .then((module) => {
      chinese = module
      for (const listener of listeners) listener()
    })
    .catch((error: unknown) => {
      loading = false
      console.error('[繁簡] 字典載入失敗，正文維持原本的字形', error)
    })
}

function subscribeChinese(listener: () => void): () => void {
  listeners.add(listener)
  loadChinese()
  return () => {
    listeners.delete(listener)
  }
}

function readChinese(): ChineseModule | null {
  return chinese
}

/** 伺服器端沒有字典，也不需要——轉換是顯示層的事。 */
function serverChinese(): ChineseModule | null {
  return null
}

function identity(text: string): string {
  return text
}

/**
 * 正文的繁簡轉換，在資料層做 (Z172).
 *
 * 正文**不走**上面那支改 DOM 的 `useScriptConversion`，即使它現在兩個方向都跑
 * 得了。原因是改 DOM 是**就地覆寫**：原文沒有留著，所以簡 → 繁 → 簡 是一次有
 * 損的來回（`乾`/`幹`/`干` 都變成 `干`，回不去），介面那一份只好靠**重新載入
 * 整頁**來還原。
 *
 * 整個介面吃得下重新載入（切字形是很少做的事），一本小說的閱讀器吃不下——它
 * 有章節、頁碼、朗讀進度，重新載入等於把讀者的位置丟掉。
 *
 * 所以這一支從原始字串算：每次都從資料庫那份轉，不累積誤差，切換不必重新載
 * 入。`convertScript` 本來就是為此而生——只是從來沒有人呼叫它。
 *
 * （`convertParagraphs` 還是沒有呼叫端。它是整章一次轉的版本，而這裡連集名、
 * 章名一起轉，所以走的是單段那一支。那一條還在 `dead-wiring-baseline.txt`
 * 上，不是這次處理的範圍。）
 *
 * 字典照樣是動態載入的：還沒載完就回原文，所以第一次繪製不會被字典擋住。
 */
export function useScriptConverter(
  preference: 'original' | 'simplified' | 'traditional'
): (text: string) => string {
  // 不能叫 `module`——Next 擋下對那個名字的賦值（no-assign-module-variable）。
  const dictionary = useSyncExternalStore(subscribeChinese, readChinese, serverChinese)

  return useMemo(() => {
    if (preference === 'original' || !dictionary) return identity
    return (text: string) => dictionary.convertScript(text, preference)
  }, [dictionary, preference])
}
