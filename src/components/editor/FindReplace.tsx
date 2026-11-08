'use client'

import type { Editor } from '@tiptap/react'
import { ArrowDown, ArrowUp, Replace, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { paintSearchHits } from '@/components/editor/search-highlight'
import { findMatches, replaceMatches } from '@/lib/editor/document-search'
import type { SearchOptions, SearchRange } from '@/lib/editor/search'
import { cn } from '@/lib/utils'

/**
 * 尋找與取代.
 *
 * The feature a long manuscript cannot do without: when a character is
 * renamed in chapter 40, every earlier mention has to change, and doing that
 * by eye across 120 episodes is how continuity errors get published.
 *
 * （範圍是**開著的這一章**。這本書一集一章，所以「全書改名」還是要一集一集
 * 開——那是另一件事，不是這個面板。）
 *
 * Done through ProseMirror positions and transactions, **not** by regexing
 * `editor.getHTML()`. The regex approach is the obvious one and it is wrong:
 * it matches inside tag names and attributes, it destroys marks that span the
 * match, and replacing the whole document collapses the undo history into a
 * single unrevertable step. Here each replacement is a real document edit, so
 * undo works one match at a time and bold stays bold.
 *
 * ## Z179：它在瀏覽器裡實測出三條壞的
 *
 * 1. **看不到相符處。** 唯一的回饋是面板上的 `3 / 69`。選取是有移動的，但
 *    ProseMirror 的選取在編輯器沒有焦點時不會畫出來——而這時候焦點在這個面板
 *    的輸入框裡。所以打完字的畫面是：數字跳了，正文一個像素都沒變。結論不會
 *    是「高亮壞了」，會是「這功能沒用」。現在改用 decoration
 *    （`search-highlight.ts`），文件不會被改髒。
 *
 * 2. **取代字串被當成 HTML。** 原本走 `insertContentAt(range, replacement)`，
 *    而 TipTap 的字串參數是**要被解析的 HTML**。取代成 `a<b & c` 進去只剩
 *    `a`，而且沒有任何錯誤——是悄悄吃掉。現在走 `schema.text()`，字面進字面
 *    出。
 *
 * 3. **取代成空字串不會刪除。** `insertContentAt(range, '')` 是零動作，於是
 *    「把這個詞全部刪掉」這個最常見的清稿動作完全沒反應。現在空字串走
 *    `tr.delete`。
 *
 * 另外兩件順手補上的：相符處**可以跨行內節點邊界**了（原本一個相符處不能橫跨
 * 兩個 text node，所以「沈知」如果「沈」是粗體就永遠找不到，而且是靜靜地找不
 * 到），以及**繁簡通用**比對（這本書的原文是簡體，而讀稿的人打繁體）。
 *
 * ## 找字與換字不在這個檔案裡
 *
 * `findMatches`／`replaceMatches` 在 `@/lib/editor/document-search`，不碰
 * TipTap 也不碰 React。它們是這個功能唯一會把稿子打散的地方（位置對照表、連續
 * 性檢查、從後往前取代），留在元件裡就只有瀏覽器 probe 驗得到——而 probe 需要
 * 一個跑起來的站台加真的稿子，所以它不在提交門檻上。搬出去之後那三件事在
 * `tests/editor-search.test.ts` 用手搭的 schema 直接斷言位置。
 */

export function FindReplace({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [needle, setNeedle] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  /*
   * 繁簡通用預設開著。
   *
   * 原文是暖寶用簡體寫的，而會來這個面板改名的是讀繁體的人：預設關掉等於預設
   * 找不到，而「找不到」跟「沒有這個詞」在畫面上長得一模一樣。
   */
  const [fold, setFold] = useState(true)
  const [index, setIndex] = useState(0)
  /** Bumped on every document change so the match list is recomputed. */
  const [revision, setRevision] = useState(0)

  /*
   * 文件一變就重算，**不管是誰改的** (Z179).
   *
   * 原本只有這個面板自己取代完才會重算。於是任何從外面來的改動——Ctrl+Z、在
   * 正文裡打字、AI 把一段插進來——都不會讓這份清單更新，而它存的是**位置**。
   *
   * 後果有兩層，而第二層是會吃掉稿子的那一層：
   *
   *   1. 撤銷之後按「取代」沒有反應。清單是撤銷前那一刻算的（當時已經沒有相
   *      符處了），所以 `matches` 是空的，按下去是零動作——而面板上的數字看
   *      起來完全正常。這是 probe 實測抓到的。
   *   2. **在正文裡打幾個字再按「全部取代」，就會砍到別的字。** 位置是舊
   *      的，文件是新的，而 ProseMirror 很樂意照舊位置改。它不會報錯。
   *
   * 所以改成訂閱 transaction。不會打轉：高亮那一支送的是**沒有步驟**的
   * transaction（`docChanged` 為 false），所以重算 → 重畫 → 不再重算。
   */
  useEffect(() => {
    /*
     * 也看 `appendedTransactions`：外掛用 `appendTransaction` 接在後面改文件
     * 時，根 transaction 的 `docChanged` 仍然是 false。TipTap 自己發 `update`
     * 事件就是看全部，不是只看根那一支。現在的擴充組合裡找不到會這樣做的，但
     * 漏掉的後果正好就是這一輪在修的那個：舊位置拿去改新文件。
     */
    const onTransaction = ({
      transaction,
      appendedTransactions,
    }: {
      transaction: { docChanged: boolean }
      appendedTransactions?: readonly { docChanged: boolean }[]
    }) => {
      const changed =
        transaction.docChanged || (appendedTransactions ?? []).some((t) => t.docChanged)
      if (changed) setRevision((n) => n + 1)
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  const options = useMemo<SearchOptions>(() => ({ fold, caseSensitive }), [fold, caseSensitive])

  const matches = useMemo(
    () => findMatches(editor.state.doc, needle, options),
    // `revision` is the dependency that matters: the document changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, needle, options, revision]
  )

  const current = matches.length > 0 ? Math.min(index, matches.length - 1) : 0

  // 把相符處畫到正文上。沒有這一步，這個面板是一個只會動數字的計數器。
  useEffect(() => {
    paintSearchHits(editor.view, matches, matches.length > 0 ? current : -1)
  }, [editor, matches, current])

  /*
   * 關掉面板就把高亮收乾淨。
   *
   * 分成自己一個 effect 而不是附在上面那個的 cleanup 裡：上面那個每次換相符處
   * 都會跑一次 cleanup，於是每一步都會先清空再重畫，閃一下。
   */
  useEffect(() => () => paintSearchHits(editor.view, [], -1), [editor])

  // Keep the selected match on screen as the user steps through.
  useEffect(() => {
    /*
     * 編輯器有焦點＝使用者正在正文裡打字，這時候絕對不能動游標 (Z179).
     *
     * 上面那個「文件一變就重算」讓這個 effect 也跟著每一次按鍵跑一遍，於是沒
     * 有這一行的話：面板開著的時候在正文裡打字，**每打一個字游標就被拉回相符
     * 處**，第二個字就打到別的地方去了。是我修前一個 bug 時帶進來的。
     *
     * 用焦點判斷而不是記一個「是誰觸發的」旗標，因為焦點就是那個意圖本身：游
     * 標在面板裡，面板才有資格開車。按「下一個」會把焦點移到那顆按鈕上，所以
     * 那條路照樣通。
     */
    if (editor.isFocused) return
    const match = matches[current]
    if (!match) return
    // 不 `.focus()`：焦點要留在輸入框裡，不然打第二個字就得先點回來。
    editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
  }, [editor, matches, current])

  /*
   * 以 `current`（裁切過的）為基準，不是 `index`。
   *
   * 相符數變少之後兩者會不一樣：`index` 停在 4、清單只剩 4 筆，畫面顯示
   * `4 / 4`，而按「下一個」會跳到 `2 / 4`（少看一個）、按「上一個」原地不動。
   */
  function step(delta: number) {
    if (matches.length === 0) return
    setIndex((current + delta + matches.length) % matches.length)
  }

  /*
   * 兩支都不用自己 `setRevision`：取代會讓文件變動，而上面那個訂閱就是在等這
   * 件事。自己再 bump 一次只是多算一輪。
   */
  function replaceCurrent() {
    const match = matches[current]
    if (!match) return
    apply([match])
  }

  function replaceAll() {
    if (matches.length === 0) return
    apply(matches)
    setIndex(0)
  }

  function apply(ranges: readonly SearchRange[]) {
    editor
      .chain()
      .command(({ tr }) => replaceMatches(tr, ranges, replacement, { needle, options }) > 0)
      .run()
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-stage-700/60 bg-stage-850/60 px-2 py-1.5">
      <label className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-ink-600"
        />
        <input
          autoFocus
          value={needle}
          onChange={(event) => {
            setNeedle(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              step(event.shiftKey ? -1 : 1)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder="尋找"
          aria-label="尋找"
          className="h-7 w-36 rounded-md bg-stage-900 pr-2 pl-7 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
      </label>

      <span
        aria-live="polite"
        className="min-w-14 text-center text-[10px] text-ink-600 tabular-nums"
      >
        {needle ? `${matches.length > 0 ? current + 1 : 0} / ${matches.length}` : '—'}
      </span>

      <IconButton label="上一個" onClick={() => step(-1)} disabled={matches.length === 0}>
        <ArrowUp aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton label="下一個" onClick={() => step(1)} disabled={matches.length === 0}>
        <ArrowDown aria-hidden className="size-3.5" />
      </IconButton>

      <span aria-hidden className="mx-0.5 h-4 w-px bg-stage-700" />

      <input
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
        placeholder="取代為"
        aria-label="取代為"
        className="h-7 w-36 rounded-md bg-stage-900 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
      />

      <button
        type="button"
        onClick={replaceCurrent}
        disabled={matches.length === 0}
        title={replacement ? undefined : '取代為留空＝刪掉相符的字'}
        className="h-7 rounded-md px-2 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
      >
        取代
      </button>
      <button
        type="button"
        onClick={replaceAll}
        disabled={matches.length === 0}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
      >
        <Replace aria-hidden className="size-3" />
        全部取代
      </button>

      <Toggle
        on={fold}
        onClick={() => setFold((value) => !value)}
        label="繁簡通用"
        title="繁簡通用：打繁體也找得到簡體的原文。關掉就是照字面精確比對。"
      >
        繁简
      </Toggle>
      <Toggle
        on={caseSensitive}
        onClick={() => setCaseSensitive((value) => !value)}
        label="區分大小寫"
        title="區分大小寫"
      >
        Aa
      </Toggle>

      <IconButton label="關閉" onClick={onClose}>
        <X aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-md p-1.5 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Toggle({
  on,
  onClick,
  label,
  title,
  children,
}: {
  on: boolean
  onClick: () => void
  label: string
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      title={title}
      className={cn(
        'h-7 shrink-0 rounded-md px-2 text-[11px] transition-colors',
        on
          ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
          : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200'
      )}
    >
      {children}
    </button>
  )
}
