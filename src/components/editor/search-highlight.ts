'use client'

import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { SearchRange } from '@/lib/editor/search'

/**
 * 把搜尋的相符處畫出來 (Z179).
 *
 * ## 為什麼需要一支外掛才能做到
 *
 * 尋找與取代原本只做兩件事：把計數寫在面板上（`3 / 69`），以及
 * `setTextSelection` 把 ProseMirror 的選取移到相符處。問題是**選取在編輯器沒
 * 有焦點時不會畫出來**——而這時候焦點在「尋找」輸入框裡，不在編輯器上。
 *
 * 所以實際看到的畫面是：打字、數字跳成 `1 / 69`、**然後什麼都沒有發生**。沒有
 * 高亮、沒有顏色、正文一個像素都沒變。使用者的結論不會是「高亮壞了」，會是
 * 「這個搜尋沒有用」——這就是為什麼有人用了之後會來說「幫我加一個搜尋取代」。
 *
 * 用 decoration 而不是「把相符處包成 `<mark>`」：decoration 是**畫面上的一層**，
 * 文件本身一個節點都沒有動。包 mark 的話，搜尋這個動作會把文件改髒、觸發自動
 * 存檔、進入復原歷史，然後關掉面板還得記得拆掉——而拆不乾淨就是把使用者的稿
 * 子改掉了。搜尋不該是一次編輯。
 *
 * ## 位置會跟著文件走
 *
 * `apply` 在文件變動時把每個區間 `tr.mapping.map` 一次。少了這一步，取代一個
 * 之後其餘的高亮會集體錯位（取代字長度不同時），而且錯的方向看起來像是「它亂
 * 標」。長度歸零的區間直接丟掉——那是被取代掉的那一個。
 */

type HighlightState = {
  ranges: readonly SearchRange[]
  /** Index into `ranges`; -1 when there is no current one. */
  current: number
}

const EMPTY: HighlightState = { ranges: [], current: -1 }

export const searchHighlightKey = new PluginKey<HighlightState>('searchHighlight')

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: searchHighlightKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const next = tr.getMeta(searchHighlightKey) as HighlightState | undefined
            if (next) return next
            if (!tr.docChanged) return value

            /*
             * Bias `+1` / `-1`，跟 ProseMirror 自己的行內 decoration 一樣
             * （`InlineType.map` 在非 inclusive 時就是這個方向）。
             *
             * 反過來寫（`-1` / `+1`）等於兩端都 inclusive，而那有兩個後果：游
             * 標停在相符處**正前面**打一個字，那個字會被一起塗上高亮；取代之
             * 後 `from` 留在原處、`to` 被映到插入內容的尾端，於是被取代掉的那
             * 一個**仍然是高亮的**，蓋在新字上直到重畫。
             */
            const ranges = value.ranges
              .map((range) => ({
                from: tr.mapping.map(range.from, 1),
                to: tr.mapping.map(range.to, -1),
              }))
              .filter((range) => range.to > range.from)

            return { ranges, current: Math.min(value.current, ranges.length - 1) }
          },
        },
        props: {
          decorations(state) {
            const here = searchHighlightKey.getState(state)
            if (!here || here.ranges.length === 0) return DecorationSet.empty

            return DecorationSet.create(
              state.doc,
              here.ranges.map((range, index) =>
                Decoration.inline(range.from, range.to, {
                  class: index === here.current ? 'search-hit search-hit-on' : 'search-hit',
                })
              )
            )
          },
        },
      }),
    ]
  },
})

/**
 * Publishes the ranges to paint.
 *
 * `addToHistory: false` because this transaction has no steps and must not
 * occupy an undo slot: pressing Ctrl+Z after a search should undo the last
 * edit, not the last thing somebody typed into the find box.
 *
 * Going through `view.dispatch` rather than a TipTap command keeps this off
 * the editor's change path entirely — a transaction with no steps leaves
 * `docChanged` false, so `onUpdate` never fires and merely searching does not
 * mark the chapter dirty.
 */
export function paintSearchHits(
  view: EditorView | null | undefined,
  ranges: readonly SearchRange[],
  current: number
): void {
  if (!view) return
  const tr = view.state.tr
  tr.setMeta(searchHighlightKey, { ranges, current } satisfies HighlightState)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}
