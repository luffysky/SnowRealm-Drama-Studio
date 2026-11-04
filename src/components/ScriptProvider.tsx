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
 * 整個介面的繁簡切換 (Z135).
 *
 * 作品有大陸市場，合夥人也是大陸人，所以介面預設顯示簡體。
 *
 * **做法是在顯示層轉，不是把字串抽成訊息檔。** 傳統 i18n 要把幾百個元件裡
 * 寫死的中文一句一句搬出來，那是好幾週的工，而且那些字串本來就只有一種語言
 * ——它們是同一句話的兩種字形，不是兩種語言。
 *
 * 之所以敢這樣做，是因為**只跑安全的方向**。原始字串是繁體，所以：
 *
 *     繁體 = 原文，一個字都不碰
 *     简体 = 轉換（繁→簡是多對一，不會猜錯）
 *
 * 簡轉繁那個一對多的方向（`干` 可能是乾／幹／干）在這裡永遠不會被執行。
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

/** 預設簡體。繁體是「原文」，所以切回去是零成本的。 */
const DEFAULT: UiScript = 'simplified'

type ScriptApi = {
  script: UiScript
  setScript: (next: UiScript) => void
}

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

const ScriptContext = createContext<ScriptApi>({ script: DEFAULT, setScript: () => {} })

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
    writeScript(next)
    /*
     * 繁體是原文，所以切回去要重新載入.
     *
     * Conversion rewrites the text nodes in place and the originals are gone
     * — there is nothing kept to put back. A reload is honest about that and
     * costs a fraction of a second, whereas keeping a shadow copy of every
     * text node in the document to support an undo is a memory leak with a
     * feature attached.
     */
    if (next === 'traditional') window.location.reload()
  }, [])

  /*
   * 整個畫面一份，而且**之後新增的內容也會跟著轉**——對話框、吐司、下一頁的
   * 清單、聊天室新進來的訊息，這些都是第一次繪製之後才出現的。
   *
   * 小說正文標了 `data-script-own`，所以不受這裡影響：它有自己的切換鍵。
   */
  useScriptConversion(wholeDocument, script === 'simplified')

  return <ScriptContext.Provider value={{ script, setScript }}>{children}</ScriptContext.Provider>
}
