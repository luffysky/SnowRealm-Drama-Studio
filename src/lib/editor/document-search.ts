import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { matchOffsets, type SearchOptions, type SearchRange } from '@/lib/editor/search'

/**
 * 在 ProseMirror 文件裡找字、換字 (Z179).
 *
 * 這一支**不碰 TipTap、不碰 React**，只碰 `@tiptap/pm` 重新匯出的
 * prosemirror-model／state。理由是測試：位置對照表、連續性檢查、從後往前取
 * 代，這三件事是這個功能唯一會把稿子打散的地方，而把它們留在元件裡就只有瀏覽
 * 器 probe 測得到——而 probe 需要一個跑起來的站台加真的稿子，所以它不會在提交
 * 門檻上跑。搬出來之後 `tests/editor-search.test.ts` 用一個手搭的 schema 直接
 * 斷言 `{from, to}`。
 *
 * 只有 `findMatches` 與 `replaceMatches` 對外；`textBlocks` 是前者的實作細
 * 節，測試量的是位置對不對，不是攤平的中間結果。
 */

type TextBlock = {
  text: string
  /** `positions[i]` 是 `text[i]` 在文件裡的位置。 */
  positions: number[]
}

/**
 * 一個文字區塊攤平成一條字串，外加每一個字在文件裡的位置。
 *
 * 原本的做法是對每一個 text node 各自 `indexOf`，而那有一個**靜靜失敗**的後
 * 果：一個相符處不能橫跨兩個 text node。`沈知味` 如果「沈」剛好被標了粗體，就
 * 是兩個 text node，於是搜尋回報「0 筆」——而那跟「這一章沒有這個名字」在畫面
 * 上完全一樣。改名正是會動到這種字的時候。
 *
 * 一個區塊一條字串，所以相符處不會跨段落（跨段落的「相符」是假的，段落之間沒
 * 有那個字）。位置用對照表而不是用「起點 + 偏移量」算：text node 之間可能夾著
 * 行內節點（圖片、換行），那時候位置不連續，而算式會算錯。
 *
 * 逐**碼元**建表，跟 ProseMirror 自己算 text node 大小的尺一樣（UTF-16 碼元
 * 數），所以代理對不會讓兩邊對不上。
 */
function textBlocks(doc: ProseMirrorNode): TextBlock[] {
  const blocks: TextBlock[] = []

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true

    let text = ''
    const positions: number[] = []
    node.descendants((child, offset) => {
      if (!child.isText || !child.text) return true
      for (let i = 0; i < child.text.length; i += 1) {
        text += child.text[i]
        // +1 跳過區塊節點自己的開頭標記。
        positions.push(pos + 1 + offset + i)
      }
      return true
    })

    if (text) blocks.push({ text, positions })
    // 文字區塊內部已經自己走完了，不要再讓外層重複走一次。
    return false
  })

  return blocks
}

/** Every occurrence, as document positions. */
export function findMatches(
  doc: ProseMirrorNode,
  needle: string,
  options: SearchOptions
): SearchRange[] {
  if (!needle) return []

  const matches: SearchRange[] = []

  for (const block of textBlocks(doc)) {
    /*
     * 只收位置連續的一段。
     *
     * 攤平的字串把中間的行內節點（圖片、換行）跳過了，所以兩段文字會黏在一
     * 起，而黏出來的「相符」在文件裡是跨過那個節點的一塊——拿去取代就會把圖片
     * 一起吃掉。
     *
     * 這是傳給 `matchOffsets` 的否決函式而不是事後過濾：事後過濾會讓被否決的
     * 候選把掃描往前推，連帶吃掉它後面重疊的真相符（見 `matchOffsets`）。
     */
    const contiguous = (offset: number) => {
      const from = block.positions[offset]
      const last = block.positions[offset + needle.length - 1]
      if (from === undefined || last === undefined) return false
      return last - from === needle.length - 1
    }

    for (const offset of matchOffsets(block.text, needle, options, contiguous)) {
      const from = block.positions[offset]
      if (from === undefined) continue
      matches.push({ from, to: from + needle.length })
    }
  }

  return matches
}

/**
 * 把這些區間換成 `replacement`，全部掛在同一個 transaction 上。
 *
 * **從後往前。** 從前面開始改的話，每一次取代都會把後面所有位置平移，於是取代
 * 字跟原字長度不一樣的時候，後面的區間就砍到別的字去了——而那是取代功能最糟
 * 的壞法：它會改稿，而且不報錯。
 *
 * 走 `schema.text()` 而不是 TipTap 的 `insertContentAt(range, string)`：後者
 * 會把字串當 HTML 解析，於是 `a<b & c` 進去只剩 `a`。`marksAcross` 讓橫跨相符
 * 處的粗體、螢光標記留在取代後的字上。
 *
 * 空字串走 `tr.delete`，而且是 `delete` 不是 `deleteRange`：`deleteRange` 會在
 * 區間剛好蓋滿一個段落時把整個段落節點一起收掉，而那會讓同一個 transaction 裡
 * **前面**的位置失效（它往回擴）。這裡要的是「刪掉這幾個字」，不多不少。
 *
 * ## 下筆之前先確認那裡真的還是那幾個字
 *
 * 相符清單是在 render 期間從 `editor.state` 算出來的，而那是一個會變的外部來
 * 源。目前每一次文件變動都會同步重算，所以位置不該過期——但「不該」在一個會
 * 改掉別人稿子的地方不夠。所以每一刀下去之前先把那一段文字取出來比對，對不上
 * 就跳過。
 *
 * 回傳真的改了幾個，呼叫端才有辦法分辨「沒有相符」與「位置過期所以什麼都沒
 * 做」——不然兩者在畫面上都是「按了沒反應」。
 */
export function replaceMatches(
  tr: Transaction,
  ranges: readonly SearchRange[],
  replacement: string,
  guard: { needle: string; options: SearchOptions }
): number {
  let applied = 0

  for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
    if (range.to <= range.from) continue
    if (range.from < 0 || range.to > tr.doc.content.size) continue

    const actual = tr.doc.textBetween(range.from, range.to)
    if (actual.length !== guard.needle.length) continue
    if (matchOffsets(actual, guard.needle, guard.options)[0] !== 0) continue

    if (replacement) {
      const marks = tr.doc.resolve(range.from).marksAcross(tr.doc.resolve(range.to))
      tr.replaceWith(range.from, range.to, tr.doc.type.schema.text(replacement, marks))
    } else {
      tr.delete(range.from, range.to)
    }
    applied += 1
  }

  return applied
}
