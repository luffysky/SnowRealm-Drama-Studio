import { readFileSync } from 'node:fs'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { foldForSearch } from '@/lib/chinese'
import { findMatches, replaceMatches } from '@/lib/editor/document-search'
import { matchOffsets } from '@/lib/editor/search'

/**
 * 編輯器的尋找與取代，比對規則那一半（Z179）。
 *
 * 這裡守的不是「找不找得到」，是**偏移量對不對**。找不到會有人回報；偏移量差
 * 一個字不會——它會把高亮標在隔壁，然後把取代砍到別的字上，而且全程不報錯。
 */

const EXACT = { fold: false, caseSensitive: true }
const FOLDED = { fold: true, caseSensitive: false }

describe('長度不變這個不變量（Z179）', () => {
  /*
   * 這是整個功能的地基。相符處的位置是用折疊後字串的偏移量算出來的，然後直接
   * 當成原文的位置拿去取代——所以折疊只要動到長度，取代就會砍錯字。
   */
  it('逐字折疊不會改變長度', () => {
    for (const sample of [
      '沈知味推開門，灶上的火還沒熄。',
      '头发/发现/着火/显著/干净/乾坤',
      '頭髮發現著火顯著乾淨乾坤',
      'ABC abc 123 ！？…—',
      '', // 空字串
    ]) {
      expect(foldForSearch(sample).length).toBe(sample.length)
    }
  })

  it('整個常用漢字區掃一遍，沒有一個折出不同長度的字', () => {
    /*
     * 名字是「沒有一個折出不同長度」，不是「轉換器一換一」——它量的是
     * `foldForSearch` 的輸出，而那一支依定義就同長。所以這條守的是**防護還
     * 在**：把 `converted.length === char.length` 那一行拿掉，它就紅。
     *
     * 而防護真的在開火：把 OpenCC 的 tw→cn 逐字餵過 0x2E80–0x2FDF、
     * 0x3400–0x4DBF、0x4E00–0x9FFF、0xF900–0xFAFF、0xFF00–0xFFEF、
     * 0x20000–0x2A6DF，**有 226 個字長度會變**（光常用區就 180 個，多半是
     * BMP 一個碼元換成增補平面兩個，像 `僤→𫢸`、`嗰→𠮶`）。這些字一律保留原
     * 字，所以繁簡通用對它們無效——換來的是偏移量永遠對得回去。
     */
    const offenders: string[] = []
    for (let code = 0x4e00; code <= 0x9fff; code += 1) {
      const char = String.fromCodePoint(code)
      if (foldForSearch(char).length !== 1) offenders.push(char)
    }
    expect(offenders).toEqual([])
  })

  it('小寫化也不會改變長度（İ 小寫是兩個碼元）', () => {
    expect('İ'.toLowerCase().length).toBe(2)
    /*
     * 量的是**結果**而不是折疊後的字串：小寫化若把一個字變成兩個，偏移量就會
     * 多一，而 `stanbul` 的起點就不再是 1。這條斷言會紅，而且紅在使用者真的
     * 會痛的那個地方（取代砍到隔壁的字）。
     */
    expect(matchOffsets('İstanbul', 'stanbul', FOLDED)).toEqual([1])
    expect(matchOffsets('İstanbul', 'İSTANBUL', FOLDED)).toEqual([0])
  })

  it('代理對（罕用漢字）不會被切成兩半', () => {
    const rare = '𠀋𡈽' // U+2000B, U+2123D，各兩個碼元
    expect(rare.length).toBe(4)
    expect(foldForSearch(rare).length).toBe(4)
  })
})

describe('繁簡通用比對（Z179）', () => {
  /* 原文是暖寶用簡體寫的，而會來改名的是讀繁體的人。 */

  it('打繁體找得到簡體的原文', () => {
    expect(matchOffsets('她的头发乱了', '頭髮', FOLDED)).toEqual([2])
  })

  it('打簡體找得到繁體的字（反方向一樣要通）', () => {
    expect(matchOffsets('她的頭髮亂了', '头发', FOLDED)).toEqual([2])
  })

  it('關掉就是照字面比對——否則上面兩條是白測的', () => {
    // 這一條是上面兩條的破壞驗證：折疊真的拿掉，它們就必須紅。
    expect(matchOffsets('她的头发乱了', '頭髮', EXACT)).toEqual([])
    expect(matchOffsets('她的頭髮亂了', '头发', EXACT)).toEqual([])
  })

  it('折疊會多收，而那是這個開關該有的行為', () => {
    // 乾/幹/干 折到同一點，所以搜「干」連「乾淨」一起找到。
    expect(matchOffsets('乾淨', '干', FOLDED)).toEqual([0])
    expect(matchOffsets('乾淨', '干', EXACT)).toEqual([])
  })

  it('沈知味不會因為折疊變成沉知味而找不到', () => {
    expect(matchOffsets('沈知味端起碗', '沈知味', FOLDED)).toEqual([0])
    expect(matchOffsets('沈知味端起碗', '沉知味', FOLDED)).toEqual([])
  })
})

describe('偏移量', () => {
  it('每一個相符處都回報起點', () => {
    expect(matchOffsets('一二三一二三一', '一二', EXACT)).toEqual([0, 3])
  })

  it('重疊的只算一次', () => {
    // `aa` 在 `aaa` 裡算一次：算兩次的話，全部取代會把中間那個字處理兩遍。
    expect(matchOffsets('aaa', 'aa', EXACT)).toEqual([0])
    expect(matchOffsets('aaaa', 'aa', EXACT)).toEqual([0, 2])
  })

  it('偏移量加長度切回去就是原字', () => {
    const haystack = '灶上的火還沒熄，沈知味把柴推進去。'
    const needle = '沈知味'
    const [at] = matchOffsets(haystack, needle, FOLDED)
    expect(at).not.toBeUndefined()
    expect(haystack.slice(at, (at as number) + needle.length)).toBe(needle)
  })

  it('空的尋找字串回零筆，不是全部', () => {
    expect(matchOffsets('隨便什麼字', '', FOLDED)).toEqual([])
    expect(matchOffsets('', '沈', FOLDED)).toEqual([])
  })

  it('大小寫：開著就分，關著就不分', () => {
    expect(matchOffsets('Fire fire FIRE', 'fire', { fold: false, caseSensitive: true })).toEqual([5])
    expect(matchOffsets('Fire fire FIRE', 'fire', EXACT)).toEqual([5])
    expect(matchOffsets('Fire fire FIRE', 'fire', FOLDED)).toEqual([0, 5, 10])
  })
})


/* -------------------------------------------------------------------------- */

/**
 * 從這裡開始是**真的在文件上做**，不是掃原始碼字串。
 *
 * 子代理審這一輪時指出：原本那一整段 `expect(source).toContain('…')` 只保證那
 * 串字還在檔案裡——`positions.push()` 裡的算式整個算錯、連續性檢查的比較寫
 * 反，它們全都還是綠的。而且它們把實作鎖成字面值，改個變數名就紅，而那不是回
 * 歸。
 *
 * 所以把 `textBlocks`／`findMatches`／`replaceMatches` 從元件裡搬到
 * `src/lib/editor/document-search.ts`，這裡手搭一個 schema 直接斷言位置。這三
 * 支正是這個功能唯一會把稿子打散的地方。
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true, selectable: false, toDOM: () => ['br'] },
    image: {
      group: 'inline',
      inline: true,
      attrs: { src: { default: '' } },
      toDOM: () => ['img'],
    },
  },
  marks: { bold: { toDOM: () => ['strong', 0] } },
})

const bold = schema.marks.bold!
const t = (text: string, marked = false) => schema.text(text, marked ? [bold.create()] : null)
const br = () => schema.nodes.hardBreak!.create()
const img = () => schema.nodes.image!.create()
const para = (...content: ProseMirrorNode[]) => schema.nodes.paragraph!.create(null, content)
const docOf = (...blocks: ProseMirrorNode[]) => schema.nodes.doc!.create(null, blocks)

/** 做一次取代，回傳改了幾個與取代後的純文字（段落之間用 ⏎ 隔開）。 */
function replaceIn(
  doc: ProseMirrorNode,
  needle: string,
  replacement: string,
  options = FOLDED
): { applied: number; text: string; doc: ProseMirrorNode } {
  const tr = EditorState.create({ schema, doc }).tr
  const applied = replaceMatches(tr, findMatches(doc, needle, options), replacement, {
    needle,
    options,
  })
  return { applied, text: tr.doc.textBetween(0, tr.doc.content.size, '⏎'), doc: tr.doc }
}

describe('在文件上找字（Z179）', () => {
  it('位置切回去就是那幾個字', () => {
    const doc = docOf(para(t('灶上的火還沒熄，沈知味把柴推進去。')))
    const [match] = findMatches(doc, '沈知味', FOLDED)
    expect(match).toBeDefined()
    expect(doc.textBetween(match!.from, match!.to)).toBe('沈知味')
  })

  it('相符處橫跨粗體邊界也找得到', () => {
    // 原本一個相符處不能橫跨兩個 text node：「沈」是粗體就永遠找不到「沈知
    // 味」，而那跟「這一章沒有這個名字」在畫面上一模一樣。
    const doc = docOf(para(t('沈', true), t('知味端起碗')))
    const matches = findMatches(doc, '沈知味', FOLDED)
    expect(matches).toHaveLength(1)
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('沈知味')
  })

  it('不會跨段落相符', () => {
    const doc = docOf(para(t('沈知')), para(t('味端起碗')))
    expect(findMatches(doc, '沈知味', FOLDED)).toEqual([])
  })

  it('不會跨換行或圖片相符——那會把節點一起吃掉', () => {
    expect(findMatches(docOf(para(t('沈知'), br(), t('味'))), '沈知味', FOLDED)).toEqual([])
    expect(findMatches(docOf(para(t('沈知'), img(), t('味'))), '沈知味', FOLDED)).toEqual([])
  })

  it('被否決的候選不會吃掉它後面重疊的真相符', () => {
    /*
     * 這是子代理審出來的那一條。段落是 `a` + 換行 + `aa`，攤平成 `aaa`。
     * offset 0 的候選跨換行要否決，而原本的掃描不論收不收都往前跳一整個
     * needle 長度，於是真正存在的那個 `aa`（offset 1）永遠看不到——回報 0 筆，
     * 不報錯，只是找不到。
     */
    const doc = docOf(para(t('a'), br(), t('aa')))
    const matches = findMatches(doc, 'aa', EXACT)
    expect(matches).toHaveLength(1)
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('aa')
  })

  it('繁簡通用在文件上也成立，而且位置是對的', () => {
    const doc = docOf(para(t('她的头发乱了，头发上还有灰。')))
    const matches = findMatches(doc, '頭髮', FOLDED)
    expect(matches).toHaveLength(2)
    for (const match of matches) {
      expect(doc.textBetween(match.from, match.to)).toBe('头发')
    }
  })

  it('多個段落各自數，不會重複也不會漏', () => {
    const doc = docOf(para(t('火')), para(t('火')), para(t('火')))
    expect(findMatches(doc, '火', EXACT)).toHaveLength(3)
  })
})

describe('在文件上取代（Z179）', () => {
  it('長度不同的取代，從後往前所以後面的不會錯位', () => {
    const { applied, text } = replaceIn(docOf(para(t('火火火'))), '火', '水水水')
    expect(applied).toBe(3)
    expect(text).toBe('水水水水水水水水水')
  })

  it('取代字串裡的 < 與 & 照字面進去', () => {
    // `insertContentAt(range, 'a<b & c')` 會把它當 HTML 解析，進去只剩 `a`。
    const { text } = replaceIn(docOf(para(t('標記'))), '標記', 'a<b & c')
    expect(text).toBe('a<b & c')
  })

  it('取代成空字串＝刪掉，而且段落還在', () => {
    const { applied, text, doc } = replaceIn(
      docOf(para(t('沈知味')), para(t('火'))),
      '沈知味',
      ''
    )
    expect(applied).toBe(1)
    expect(text).toBe('⏎火')
    // `deleteRange` 會把整個段落收掉，`delete` 不會——而往回擴會讓同一個
    // transaction 裡前面的位置失效。
    expect(doc.childCount).toBe(2)
  })

  it('橫跨相符處的粗體留在取代後的字上', () => {
    const { doc } = replaceIn(docOf(para(t('沈知味', true))), '沈知味', '許山河')
    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe('許山河')
    expect(text.marks.map((mark) => mark.type.name)).toEqual(['bold'])
  })

  it('位置過期就拒絕下刀，而且回報改了零個', () => {
    /*
     * 相符清單是從會變的 `editor.state` 算出來的。目前每次文件變動都會重算，
     * 所以不該過期——但「不該」在一個會改掉別人稿子的地方不夠。拿舊位置去改
     * 新文件，正是這一輪在修的那個壞法。
     */
    const stale = findMatches(docOf(para(t('沈知味端起碗'))), '沈知味', FOLDED)
    const moved = docOf(para(t('前面多了幾個字，沈知味端起碗')))

    const tr = EditorState.create({ schema, doc: moved }).tr
    const applied = replaceMatches(tr, stale, '許山河', { needle: '沈知味', options: FOLDED })

    expect(applied).toBe(0)
    expect(tr.doc.textBetween(0, tr.doc.content.size)).toBe('前面多了幾個字，沈知味端起碗')
  })

  it('超出文件的位置不會丟例外', () => {
    const tr = EditorState.create({ schema, doc: docOf(para(t('火'))) }).tr
    expect(() =>
      replaceMatches(tr, [{ from: 900, to: 903 }], '水', { needle: '火火火', options: EXACT })
    ).not.toThrow()
  })
})

describe('程式碼層面只剩沒有 DOM 就驗不了的那幾條（Z179）', () => {
  /**
   * 註解不算程式碼：掃原始檔的斷言會被**解釋那個錯的註解**自己打中，於是為了
   * 讓測試綠就得把說明刪掉——那是把測試變成寫作限制。
   */
  const codeOnly = (path: string) =>
    readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const source = codeOnly('src/components/editor/FindReplace.tsx')

  it('編輯器有焦點時不動游標——不然打字會被搶走', () => {
    /*
     * 這一條沒有 jsdom 驗不了（它是 React effect 加焦點狀態），而
     * `scripts/probe-find-replace.mjs` 的「兩個字要黏在一起」實測過拿掉會紅。
     * 這裡留一條字串斷言，是因為 probe 不在提交門檻上。
     */
    expect(source).toContain('if (editor.isFocused) return')
  })

  it('文件在外面被改動時會重算相符清單，連 appended 的也算', () => {
    expect(source).toContain("editor.on('transaction', onTransaction)")
    expect(source).toContain("editor.off('transaction', onTransaction)")
    expect(source).toContain('appendedTransactions')
  })

  it('高亮用 decoration，不改文件、不佔一格復原', () => {
    const plugin = codeOnly('src/components/editor/search-highlight.ts')
    expect(plugin).toContain('Decoration.inline')
    expect(plugin).toContain("setMeta('addToHistory', false)")
    expect(plugin).toContain('tr.mapping.map')
    expect(source).toContain('paintSearchHits')
  })

  it('搜尋面板的外掛只在模組開著時才掛上', () => {
    const extensions = codeOnly('src/components/editor/extensions.ts')
    expect(extensions).toContain("enabled.has('findReplace')")
    expect(extensions).toContain('extensions.push(SearchHighlight)')
  })
})
