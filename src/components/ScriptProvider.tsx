'use client'

import { useScriptConversion } from '@/lib/use-script-conversion'
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

/**
 * 整個介面的繁簡切換 (Z135，方向在 Z172 補齊).
 *
 * 寫稿的人是大陸人，所以介面預設顯示簡體。
 *
 * **做法是在顯示層轉，不是把字串抽成訊息檔。** 傳統 i18n 要把幾百個元件裡
 * 寫死的中文一句一句搬出來，那是好幾週的工，而且那些字串本來就只有一種語言
 * ——它們是同一句話的兩種字形，不是兩種語言。
 *
 * ## 原本只跑一個方向，而那讓「繁體」變成一顆關閉鍵
 *
 * 這裡原本傳 `script === 'simplified'` 這個布林進去，理由是「原始字串是繁
 * 體，所以繁體 = 原文、一個字都不碰」。
 *
 * 那句話對我們寫死的標籤成立，對**畫面上絕大多數的中文不成立**：場次內容、
 * 分鏡描述、角色小傳、搜尋結果、聊天訊息都是從資料庫來的，而稿子是簡體寫
 * 的。於是選「繁體」只是把轉換關掉，整個介面停在簡體。
 *
 * 現在把偏好設定本身傳下去，兩個方向都真的跑。危險的那一個（簡 → 繁，一對
 * 多）在 `chinese.ts` 裡有防護：一段文字只要帶著繁體獨有字就不碰它，所以寫
 * 死的繁體標籤不會被「校正」。
 *
 * 三件讓它不出事的事：
 *
 *  1. **不碰輸入中的文字。** `<input>`、`<textarea>`、`contenteditable`
 *     全部跳過——在編輯器裡打字時把字換掉，等於改了作者正在寫的稿。
 *  2. **不碰正文。** 小說閱讀器有自己的切換鍵（`data-script-own`），兩邊
 *     互不影響。
 *  3. **轉換是等冪的。** 已經是簡體的文字再轉一次還是自己，所以我們自己造成
 *     的 DOM 變動不會讓觀察器無限循環。
 *
 * 資料庫裡的字**一個都沒有變**。這只是顯示。
 */

export type UiScript = 'traditional' | 'simplified'

const STORAGE_KEY = 'srds.ui.script.v1'

/**
 * 預設簡體，因為寫稿的人讀簡體 (Z172 改寫理由).
 *
 * 原本的理由是「繁體是原文，所以切回去是零成本的」——那不成立了，兩個方向
 * 現在都是一次有損的就地覆寫，切哪一邊都要重新載入。留著簡體當預設，是因為
 * 預設值該服務寫得最多的那個人。
 */
const DEFAULT: UiScript = 'simplified'

type ScriptApi = {
  script: UiScript
  setScript: (next: UiScript) => void
  /**
   * 把文字折成同一種字形，給「比對使用者打的字」用 (Z139).
   *
   * 畫面顯示的是轉換後的字形，而資料庫裡存的是原值。要使用者打名字確認的地
   * 方（刪除素材）如果直接比對原值，**照著畫面打反而不給過**——是這個轉換
   * 功能自己製造出來的坑。
   *
   * 算式在 `chinese.ts` 的 `foldForCompare`，連同它為什麼不是「兩邊都折成簡
   * 體」的理由與實測。放在那邊是為了測得到。
   */
  fold: (text: string) => string
}

/**
 * 比對用的轉換器，載好之後留一份參照。
 *
 * 留整包而不是只留 `toSimplified`：`fold` 要先套畫面那條轉換（`convertScript`）
 * 才折，理由見 `ScriptApi.fold`。還沒載好就原樣返回——那一刻誠實的答案就是
 * 「還不知道」，而使用者打字進對話框時它早已載好。
 */
let dictionary: typeof import('@/lib/chinese') | null = null

void import('@/lib/chinese')
  .then((loaded) => {
    dictionary = loaded
  })
  .catch(() => {
    /*
     * 載不到就讓 `fold` 當恆等函式.
     *
     * 失敗最常見的原因是部署之後舊的 chunk 失效。那時候嚴格比對是對的：畫面
     * 上也沒有被轉換過（轉換走的是同一個 import），所以使用者看到的就是原
     * 值。
     */
  })

/* -------------------------------------------------------------------------- */
/* The stored preference, as an external store                                 */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>()

/**
 * Cached, because `useSyncExternalStore` compares snapshots by identity and
 * will loop forever if the getter keeps returning a fresh value.
 */
let cached: UiScript | null = null

function readScript(): UiScript {
  if (cached !== null) return cached

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    cached = saved === 'traditional' || saved === 'simplified' ? saved : DEFAULT
  } catch {
    // Private window, or blocked site data. It just does not remember.
    cached = DEFAULT
  }

  return cached
}

function writeScript(next: UiScript): void {
  cached = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* Not worth interrupting anyone over. */
  }
  for (const listener of listeners) listener()
}

function subscribeToScript(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const ScriptContext = createContext<ScriptApi>({
  script: DEFAULT,
  setScript: () => {},
  fold: (text) => text,
})

export function useUiScript(): ScriptApi {
  return useContext(ScriptContext)
}

/** Stable across renders, so the hook's effect is not torn down each time. */
const wholeDocument = () => document.body

export function ScriptProvider({ children }: { children: ReactNode }) {
  /*
   * `useSyncExternalStore` rather than reading into state in a mount effect.
   *
   * The server has no `localStorage`, so the server snapshot is the default
   * and the client's is whatever was saved — React reconciles the two without
   * a `setState` inside an effect, which is both an extra render and the
   * thing `react-hooks/set-state-in-effect` forbids. Same reason `Dialog`
   * uses it to find out whether it has mounted.
   */
  const script = useSyncExternalStore(subscribeToScript, readScript, () => DEFAULT)

  const setScript = useCallback((next: UiScript) => {
    // 點已經選中的那一顆不該重載整頁 (Z174)。
    if (next === readScript()) return
    writeScript(next)
    /*
     * 哪一邊都要重新載入 (Z172).
     *
     * 本來只有切到繁體才載入，因為繁體是「原文、一個字都不碰」，另一個方向
     * 是可以直接往上疊的一次轉換。兩個方向都會轉之後那就不成立了：轉換是就
     * 地覆寫文字節點，原文沒有留著。
     *
     * 簡 → 繁 那一邊的損失很明白（一對多，`乾`/`幹`/`干` 都成了 `干`，回不
     * 去）。繁 → 簡 那一邊**多數情況無損**，所以說「兩個方向都有損」是講過頭
     * 了——但它不是零：`薰香` 折成簡體是 `熏香`，再轉回繁體得到 `薰香`，而原
     * 本可能就是 `熏香`（同一組字害 `fold` 不對稱，見上面）。既然兩邊都可能
     * 走樣，就兩邊都從伺服器那份重新算。
     *
     * 重新載入是誠實的做法，代價是幾分之一秒；替代方案是替整份文件的每一個
     * 文字節點留一份影子複本好支援還原，那是一個掛著功能的記憶體洩漏。
     */
    window.location.reload()
  }, [])

  /*
   * 整個畫面一份，而且**之後新增的內容也會跟著轉**——對話框、吐司、下一頁的
   * 清單、聊天室新進來的訊息，這些都是第一次繪製之後才出現的。
   *
   * 小說正文標了 `data-script-own`，所以不受這裡影響：它有自己的切換鍵。
   */
  useScriptConversion(wholeDocument, script)

  /*
   * 同一份轉換器，拿來做比對 (Z139)，而且**不分模式** (Z172).
   *
   * 本來只在簡體模式下折，理由是「繁體模式下畫面沒有被轉換過」。繁體模式現
   * 在會轉了，所以那個條件會把 Z139 修掉的坑原封不動搬到另一邊：畫面上是繁
   * 體、資料庫裡是簡體，照著畫面打一樣不給過。
   *
   * 兩個呼叫端是對稱的（`fold(typed) === fold(name)`），所以要的只是一個**兩
   * 邊都落在同一點**的函式。折成簡體本身不夠，因為 `簡(繁體化(x))` 不等於
   * `簡(x)`（`熏香` → `薰香` → `薰香`）——所以先套畫面那條轉換再折。那也是
   * 為什麼它要依賴 `script`：畫面顯示的是什麼，比對就要以什麼為準。
   */
  const fold = useCallback(
    (text: string) => {
      if (!dictionary) return text
      return dictionary.foldForCompare(text, script)
    },
    [script]
  )

  return (
    <ScriptContext.Provider value={{ script, setScript, fold }}>{children}</ScriptContext.Provider>
  )
}
