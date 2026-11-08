import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeBytes } from '@/lib/import/decode'
import { filenameGuide, FILENAME_KEYWORDS, readFilename } from '@/lib/import/filename'
import { detectMapping, foldHeader, mapRows, type MapContext } from '@/lib/import/map'
import { parseNovelMarkdown } from '@/lib/import/novel-doc'
import { ImportParseError, parseSheet } from '@/lib/import/parse'
import {
  SHEET_FORMAT_LABEL,
  templateFor,
  templateGuide,
  writeSheet,
  type SheetFormat,
} from '@/lib/import/sheet-format'
import { IMPORT_TARGETS, importTarget } from '@/lib/import/targets'
import { parseXlsx } from '@/lib/import/xlsx'

/**
 * 匯入的解析與對應（Z185）。
 *
 * 這個功能最危險的不是「讀不進來」——讀不進來會報錯，人看得到。危險的是**讀
 * 進來但對錯欄**：一句帶逗號的台詞把整列往後推一格，於是台詞被存進「誰說
 * 的」，而那要等到配音的時候才有人發現。所以這份測試的重心在欄位對應與儲存
 * 格邊界，不在「能不能開檔」。
 */

const EMPTY: MapContext = { terms: [], characters: new Map() }

describe('格式偵測', () => {
  it('六種都認得出來', () => {
    expect(parseSheet('[{"a":1}]').format).toBe('json')
    expect(parseSheet('{"rows":[]}').format).toBe('json')
    expect(parseSheet('{"a":1}\n{"a":2}').format).toBe('jsonl')
    expect(parseSheet('a,b\n1,2').format).toBe('csv')
    expect(parseSheet('a\tb\n1\t2').format).toBe('tsv')
    expect(parseSheet('| a | b |\n|---|---|\n| 1 | 2 |').format).toBe('markdown')
    expect(parseSheet('<table><tr><td>a</td></tr></table>').format).toBe('html')
  })

  it('一句帶逗號的台詞不會把 CSV 判成 TSV', () => {
    /*
     * 判準是「哪一種分隔符多」，不是「有沒有 tab」。用「有沒有」的話，一個
     * 欄位裡出現的 tab 就會讓整個檔案被當成 TSV，而那時候每一列只有一欄。
     */
    expect(parseSheet('場次,台詞\nS01,"來了，來了"').format).toBe('csv')
  })

  it('單一個 JSON 物件不是 JSONL', () => {
    expect(parseSheet('{"a":1}').format).toBe('json')
  })

  it('空的就報錯，不要回一張空表', () => {
    expect(() => parseSheet('   ')).toThrow(ImportParseError)
  })
})

describe('CSV 的引號規則', () => {
  it('引號裡的逗號不切欄', () => {
    const sheet = parseSheet('場次,台詞\nS01,"來了，來了，熱的"')
    expect(sheet.rows[0]).toEqual(['S01', '來了，來了，熱的'])
  })

  it('引號裡的換行不切列', () => {
    // 多行台詞長這樣。先切行再切欄的做法在這裡會變成兩列殘缺的資料。
    const sheet = parseSheet('場次,台詞\nS01,"第一句\n第二句"')
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0]?.[1]).toBe('第一句\n第二句')
  })

  it('兩個引號是一個引號', () => {
    const sheet = parseSheet('a\n"他說""好"""')
    expect(sheet.rows[0]?.[0]).toBe('他說"好"')
  })

  it('CRLF 與尾端空行都吃得下', () => {
    const sheet = parseSheet('a,b\r\n1,2\r\n\r\n')
    expect(sheet.rows).toEqual([['1', '2']])
  })

  it('欄數不齊的列會補齊，多的丟掉', () => {
    const sheet = parseSheet('a,b,c\n1,2\n1,2,3,4')
    expect(sheet.rows).toEqual([
      ['1', '2', ''],
      ['1', '2', '3'],
    ])
  })

  it('沒有標題的欄會有一個指得到的名字', () => {
    // 對應表要有東西可以指，不然那一欄在介面上是一片空白。
    const sheet = parseSheet('a,,c\n1,2,3')
    expect(sheet.headers[1]).toBe('欄 2')
  })

  it('BOM 不會黏在第一個欄名上', () => {
    // Excel 存出來的 UTF-8 CSV 幾乎都有 BOM，而 `﻿場次` 對不上任何別名。
    const sheet = parseSheet('﻿場次,秒數\nS01,5')
    expect(sheet.headers[0]).toBe('場次')
  })
})

describe('JSON', () => {
  it('陣列、包一層、單一物件都收', () => {
    expect(parseSheet('[{"a":"1"}]').rows).toEqual([['1']])
    expect(parseSheet('{"shots":[{"a":"1"}]}').rows).toEqual([['1']])
    expect(parseSheet('{"a":"1"}').rows).toEqual([['1']])
  })

  it('欄位取所有列的聯集，不是第一列的鍵', () => {
    /*
     * 模型在沒有值的時候常常省略那個鍵。只看第一列的話，第三列才出現的「備
     * 註」會整欄消失——而且不會有任何東西提到它。
     */
    const sheet = parseSheet('[{"a":"1"},{"a":"2","b":"x"}]')
    expect(sheet.headers).toEqual(['a', 'b'])
    expect(sheet.rows).toEqual([
      ['1', ''],
      ['2', 'x'],
    ])
  })

  it('巢狀的值攤平，不是整筆丟掉', () => {
    const sheet = parseSheet('[{"speaker":{"name":"沈知味"},"lines":["一","二"],"n":5}]')
    expect(sheet.rows[0]).toEqual(['沈知味', '一\n二', '5'])
  })

  it('壞掉的 JSON 講得出哪裡壞', () => {
    expect(() => parseSheet('[{"a":}]')).toThrow(/JSON/)
  })

  it('JSONL 一行一筆', () => {
    const sheet = parseSheet('{"a":"1"}\n{"a":"2"}')
    expect(sheet.format).toBe('jsonl')
    expect(sheet.rows).toEqual([['1'], ['2']])
  })
})

describe('Markdown 與 HTML 表格', () => {
  it('Markdown 的分隔列不算一列資料', () => {
    const sheet = parseSheet('| 場次 | 秒數 |\n|:---|---:|\n| S01 | 5 |')
    expect(sheet.headers).toEqual(['場次', '秒數'])
    expect(sheet.rows).toEqual([['S01', '5']])
  })

  it('Markdown 裡跳脫的直線是內容，不是分隔', () => {
    const sheet = parseSheet('| a |\n|---|\n| 甲\\|乙 |')
    expect(sheet.rows[0]?.[0]).toBe('甲|乙')
  })

  it('HTML 的 <br> 是換行，實體會還原', () => {
    const sheet = parseSheet(
      '<table><tr><th>台詞</th></tr><tr><td>第一句<br>第二句 &amp; &#x4e00;</td></tr></table>'
    )
    expect(sheet.rows[0]?.[0]).toBe('第一句\n第二句 & 一')
  })

  it('HTML 只吃第一張表', () => {
    // 一個回答裡有兩張表時，第二張通常是說明——接起來會得到一堆對不上的列。
    const sheet = parseSheet(
      '<table><tr><td>a</td></tr><tr><td>1</td></tr></table><table><tr><td>b</td></tr></table>'
    )
    expect(sheet.rows).toEqual([['1']])
  })

  it('&amp;lt; 要變成 &lt;，不是 <', () => {
    const sheet = parseSheet('<table><tr><td>x</td></tr><tr><td>&amp;lt;</td></tr></table>')
    expect(sheet.rows[0]?.[0]).toBe('&lt;')
  })
})

describe('Excel', () => {
  const file = readFileSync('tests/fixtures/storyboard-sample.xlsx')

  it('讀的是活頁簿的第一個分頁，不是 sheet1.xml', () => {
    /*
     * 刪掉分頁再新增就會讓檔名順序跟分頁順序對不上。fixture 刻意把第一個分
     * 頁指向 `sheet2.xml`，而 `sheet1.xml` 裡放了一句「不該被讀到」。
     */
    const sheet = parseXlsx(file)
    expect(JSON.stringify(sheet)).not.toContain('不該被讀到')
    expect(sheet.headers).toEqual(['場次', '秒數', '景別', '畫面描述'])
  })

  it('同一格裡的多段文字會接起來', () => {
    // `<si>` 裡有好幾個 `<t>`（同一格不同格式）。不接的話只會拿到前半截。
    expect(parseXlsx(file).rows[0]?.[3]).toBe('沈知味推開門')
  })

  it('空白的格子不會讓整列往左移', () => {
    /*
     * 空格在 XML 裡整個不出現，所以「數第幾個 `<c>`」會錯位。fixture 的第三
     * 列缺 C 欄，而最後一欄必須還是落在「畫面描述」。
     */
    const sheet = parseXlsx(file)
    expect(sheet.rows[1]).toEqual(['S01', '8', '', '灶火燒起來，說「來了」'])
  })

  it('公式取算好的值', () => {
    expect(parseXlsx(file).rows[1]?.[1]).toBe('8')
  })

  it('不是 xlsx 的東西講人話', () => {
    expect(() => parseXlsx(Buffer.from('hello'))).toThrow(/不是一個 .xlsx/)
  })
})

describe('欄位對應', () => {
  const shots = importTarget('shots')

  it('中文欄名對得上', () => {
    const mapping = detectMapping(['場次', '秒數', '景別', '運鏡', '畫面描述'], shots)
    expect(mapping).toEqual(['sceneCode', 'durationSec', 'shotSize', 'camera', 'action'])
  })

  it('簡體欄名一樣對得上', () => {
    // 模型用簡體回答是常態，而欄名對不上的症狀是「每一欄都要自己選」。
    const mapping = detectMapping(['场次', '秒数', '景别', '运镜', '画面描述'], shots)
    expect(mapping).toEqual(['sceneCode', 'durationSec', 'shotSize', 'camera', 'action'])
  })

  it('英文鍵名對得上', () => {
    const mapping = detectMapping(['sceneCode', 'durationSec', 'shotSize', 'camera'], shots)
    expect(mapping).toEqual(['sceneCode', 'durationSec', 'shotSize', 'camera'])
  })

  it('帶括號補充說明的欄名也對得上', () => {
    expect(detectMapping(['景別（必填）'], shots)).toEqual(['shotSize'])
  })

  it('完全相等優先於包含', () => {
    /*
     * 「秒數」與「預估秒數」兩個別名都存在時，前者不該被後者吃掉。沒有這一
     * 條的話，兩欄會搶同一個欄位，而輸的那一欄變成「不匯入」。
     */
    const scenes = importTarget('scenes')
    expect(detectMapping(['預估秒數', '時間'], scenes)).toEqual(['estimatedSec', 'timeOfDay'])
  })

  it('一個欄位只會被認領一次', () => {
    const mapping = detectMapping(['景別', '鏡別'], shots)
    expect(mapping.filter((key) => key === 'shotSize')).toHaveLength(1)
    expect(mapping[1]).toBeNull()
  })

  it('不認得的欄位回 null，而不是亂塞', () => {
    expect(detectMapping(['我自己加的一欄'], shots)).toEqual([null])
  })

  it('折疊會把空白與標點拿掉，但不會拿掉文字', () => {
    /*
     * 「必填」兩個字留著是對的——折疊只負責把格式差異抹平（繁簡、空白、括
     * 號），而「標題帶補充說明」是靠 `detectMapping` 的包含比對處理的。折疊
     * 階段就把它吃掉的話，`秒數` 與 `預估秒數` 也會被折成同一個東西。
     */
    expect(foldHeader('畫面 描述（必填）')).toBe('画面描述必填')
    expect(foldHeader('畫面描述')).toBe(foldHeader('画面 描述'))
  })
})

describe('每一格怎麼變成值', () => {
  const shots = importTarget('shots')
  const sheet = (headers: string[], rows: string[][]) => ({
    headers,
    rows,
    format: 'csv' as const,
  })

  it('全形數字與單位都讀得出來', () => {
    const result = mapRows(
      sheet(['秒數'], [['５ 秒'], ['1,200']]),
      ['durationSec'],
      shots,
      EMPTY
    )
    expect(result.rows[0]?.durationSec).toBe(5)
    // 超過上限的夾住並回報，不是整列丟掉。
    expect(result.rows[1]?.durationSec).toBe(120)
    expect(result.issues.some((issue) => issue.level === 'warning')).toBe(true)
  })

  it('不是數字就整列不匯入', () => {
    const result = mapRows(sheet(['秒數'], [['大概五秒吧']]), ['durationSec'], shots, EMPTY)
    expect(result.rows).toHaveLength(0)
    expect(result.issues[0]?.level).toBe('error')
  })

  it('景別認得中文、代碼與簡體', () => {
    const result = mapRows(
      sheet(['景別'], [['近景'], ['MCU'], ['特写']]),
      ['shotSize'],
      shots,
      EMPTY
    )
    expect(result.rows.map((row) => row.shotSize)).toEqual(['MCU', 'MCU', 'CU'])
  })

  it('認不得的景別會新增成選項，而且只新增一次', () => {
    const result = mapRows(
      sheet(['景別'], [['過肩'], ['過肩'], ['over the shoulder']]),
      ['shotSize'],
      shots,
      EMPTY
    )
    expect(result.newVocabulary).toHaveLength(2)
    expect(result.newVocabulary[0]).toMatchObject({ kind: 'shot_size', label: '過肩' })
    // 代碼撞不到彼此，也撞不到內建的。
    const codes = result.newVocabulary.map((item) => item.value)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('OVER_THE_SHOULDER')
  })

  it('狀態認不得就退回預設並講出來，不會自己加', () => {
    /*
     * 狀態有程式分支在讀它。多一個值出來，看板分欄與完成判定會各自用各自的
     * 方式忽略它——那不是多一個選項，是幾個地方各壞一種壞法。
     */
    const result = mapRows(sheet(['狀態'], [['審核中']]), ['status'], shots, EMPTY)
    expect(result.rows[0]?.status).toBeUndefined()
    expect(result.newVocabulary).toHaveLength(0)
    expect(result.issues[0]?.message).toContain('不是狀態的選項')
  })

  it('說話人照名字對，對不到就留空並回報', () => {
    const context: MapContext = {
      terms: [],
      characters: new Map([['沈知味', 'char-1']]),
    }
    const result = mapRows(
      sheet(['誰說的'], [['沈知味'], ['沈知味'], ['路人甲']]),
      ['speaker'],
      shots,
      context
    )
    expect(result.rows[0]?.speaker).toBe('char-1')
    expect(result.rows[2]?.speaker).toBeUndefined()
    expect(result.issues.some((issue) => issue.message.includes('路人甲'))).toBe(true)
  })

  it('說話人用簡體寫也對得到繁體的角色', () => {
    const context: MapContext = { terms: [], characters: new Map([['许山河', 'char-2']]) }
    const result = mapRows(sheet(['誰說的'], [['許山河']]), ['speaker'], shots, context)
    expect(result.rows[0]?.speaker).toBe('char-2')
  })

  it('太長的字截掉並回報，不是整列丟掉', () => {
    const long = '字'.repeat(4000)
    const result = mapRows(sheet(['畫面描述'], [[long]]), ['action'], shots, EMPTY)
    expect(String(result.rows[0]?.action)).toHaveLength(3000)
    expect(result.issues[0]?.level).toBe('warning')
  })

  it('整列空白就跳過，不報錯', () => {
    const result = mapRows(sheet(['場次'], [[''], ['S01']]), ['sceneCode'], shots, EMPTY)
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toEqual([1])
    expect(result.issues).toHaveLength(0)
  })

  it('必填欄位空的那一列整列不匯入', () => {
    const characters = importTarget('characters')
    const result = mapRows(
      { headers: ['姓名', '別名'], rows: [['', '味丫頭']], format: 'csv' },
      ['name', 'alias'],
      characters,
      EMPTY
    )
    expect(result.rows).toHaveLength(0)
    expect(result.issues[0]?.message).toContain('必填')
  })

  it('日期只收看得出年月日的寫法', () => {
    /*
     * 每一列都要帶「標題」——任務的標題是必填，少了它整列會被跳過，而那時候
     * 「日期有沒有讀對」這件事根本沒有被測到（斷言會對著一個空陣列成立）。
     */
    const tasks = importTarget('tasks')
    const ok = mapRows(
      {
        headers: ['標題', '到期日'],
        rows: [
          ['甲', '2026-11-20'],
          ['乙', '2026年11月20日'],
          ['丙', '2026/11/20'],
        ],
        format: 'csv',
      },
      ['title', 'dueDate'],
      tasks,
      EMPTY
    )
    expect(ok.rows.map((row) => String(row.dueDate).slice(0, 10))).toEqual([
      '2026-11-20',
      '2026-11-20',
      '2026-11-20',
    ])
  })

  it('03/04/2026 這種不猜', () => {
    /*
     * 猜錯的日期跟對的日期長得一模一樣，而這種錯會一路活到結算。所以寧可留
     * 空並回報。
     */
    const tasks = importTarget('tasks')
    const result = mapRows(
      { headers: ['標題', '到期日'], rows: [['甲', '03/04/2026']], format: 'csv' },
      ['title', 'dueDate'],
      tasks,
      EMPTY
    )
    // 這一列有進來（標題在），只是日期那一格留空——這樣斷言才不是空的。
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.dueDate).toBeUndefined()
    expect(result.issues[0]?.level).toBe('warning')
  })

  it('2 月 31 日不會被推成 3 月 3 日', () => {
    const tasks = importTarget('tasks')
    const result = mapRows(
      { headers: ['標題', '到期日'], rows: [['甲', '2026-02-31']], format: 'csv' },
      ['title', 'dueDate'],
      tasks,
      EMPTY
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.dueDate).toBeUndefined()
  })

  it('沒有對應的欄不會進資料', () => {
    const result = mapRows(
      sheet(['場次', '我自己加的'], [['S01', '隨便']]),
      ['sceneCode', null],
      shots,
      EMPTY
    )
    expect(result.rows[0]).toEqual({ sceneCode: 'S01' })
  })
})

describe('範本自己匯得回去（Z185）', () => {
  /*
   * 這一條守的是**欄位定義漂移**。範本、匯入對照表與驗證是同一份定義算出來
   * 的，所以只要有人改了標籤而忘了別名，這裡就會紅——而不是等到使用者照著
   * 範本填完、匯入時發現每一欄都對不上。
   */
  const formats: SheetFormat[] = ['csv', 'tsv', 'json', 'markdown']

  for (const target of IMPORT_TARGETS) {
    for (const format of formats) {
      it(`${target.label}　${SHEET_FORMAT_LABEL[format]}`, () => {
        const sheet = parseSheet(templateFor(target.key, format))
        const mapping = detectMapping(sheet.headers, target)

        /*
         * 比**位置**，不只比集合 (Z190).
         *
         * 原本只斷言「每一個欄位都出現在對應表裡」——而兩個欄位互相對調它照
         * 樣綠，而那正是子代理抓到的那一類錯（負面提示詞被對到正向欄位）。
         * 範本的第 i 欄就是第 i 個欄位，所以這裡可以直接比。
         */
        expect(mapping).toEqual(target.fields.map((field) => field.key))
      })
    }
  }

  it('JSON 範本帶著逐欄說明', () => {
    const parsed = JSON.parse(templateFor('shots', 'json')) as Record<string, unknown>
    expect(parsed._說明).toContain('分鏡')
    expect(Object.keys(parsed._每一欄要填什麼 as object)).toContain('景別')
  })

  it('說明文件列得出每一個欄位', () => {
    const guide = templateGuide('characters')
    for (const field of importTarget('characters').fields) {
      expect(guide).toContain(field.label)
    }
  })

  it('示範值裡的逗號不會把 CSV 弄壞', () => {
    // 每個 target 的 sample 都要能原樣讀回來，不然範本本身就是壞的。
    for (const target of IMPORT_TARGETS) {
      const sheet = parseSheet(templateFor(target.key, 'csv'))
      expect(sheet.rows[0]).toEqual(target.fields.map((field) => field.sample))
    }
  })
})

describe('寫出去的檔案', () => {
  it('CSV 會把逗號、引號與換行包起來', () => {
    const text = writeSheet(['a', 'b'], [['來了，來了', '他說"好"'], ['第一行\n第二行', '']], 'csv')
    expect(parseSheet(text).rows).toEqual([
      ['來了，來了', '他說"好"'],
      ['第一行\n第二行', ''],
    ])
  })

  it('TSV 把 tab 與換行換掉，不然貼回試算表會錯位', () => {
    const text = writeSheet(['a'], [['有\ttab\n跟換行']], 'tsv')
    expect(text.split('\n')).toHaveLength(2)
  })

  it('Markdown 的直線會跳脫', () => {
    const text = writeSheet(['a'], [['甲|乙']], 'markdown')
    expect(parseSheet(text).rows[0]?.[0]).toBe('甲|乙')
  })
})

/* -------------------------------------------------------------------------- */

describe('編碼（Z185）', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text)

  it('UTF-8 沒有 BOM 也讀得出來', () => {
    const result = decodeBytes(utf8('場次,秒數\nS01,5'))
    expect(result.encoding).toBe('utf-8')
    expect(result.text).toContain('場次')
    expect(result.note).toBeNull()
  })

  it('UTF-8 的 BOM 會被吃掉', () => {
    /*
     * 不吃掉的話，第一個欄名是 `\ufeff場次`——它對不上任何別名，於是使用者看
     * 到的是「第一欄要自己選」而不是錯誤，他會以為是自己的檔案有問題。
     */
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('場次')])
    const result = decodeBytes(bytes)
    expect(result.text).toBe('場次')
    expect(result.encoding).toContain('BOM')
  })

  it('UTF-16 要有 BOM，而且會講一聲', () => {
    const body = '場次'
    const le = new Uint8Array(2 + body.length * 2)
    le[0] = 0xff
    le[1] = 0xfe
    for (let i = 0; i < body.length; i += 1) {
      const code = body.charCodeAt(i)
      le[2 + i * 2] = code & 0xff
      le[3 + i * 2] = code >> 8
    }
    const result = decodeBytes(le)
    expect(result.text).toBe('場次')
    expect(result.encoding).toBe('utf-16le')
    expect(result.note).toContain('UTF-16')
  })

  it('Big5 的 CSV 不會變成一排問號', () => {
    /*
     * 繁體 Windows 的 Excel「另存 CSV」預設就是 Big5。當成 UTF-8 讀的話每一
     * 格都是「�」——而那會**過得了驗證**，因為亂碼也是合法的字串，於是兩百列
     * 問號進資料庫。
     */
    const bytes = new Uint8Array([0xa4, 0x40, 0xa4, 0x47, 0x2c, 0xa4, 0x54]) // 一二,三
    const result = decodeBytes(bytes)
    expect(result.text).toBe('一二,三')
    expect(result.encoding).toBe('big5')
    expect(result.note).toContain('Big5')
  })

  it('GBK 的 CSV 也讀得出來', () => {
    const bytes = new Uint8Array([0xd2, 0xbb, 0xb6, 0xfe, 0x2c, 0xc8, 0xfd]) // 一二,三
    const result = decodeBytes(bytes)
    expect(result.text).toBe('一二,三')
    expect(['big5', 'gb18030']).toContain(result.encoding)
  })

  it('純 ASCII 不會被誤判成中文編碼', () => {
    // 嚴格 UTF-8 解得過就不往下猜——ASCII 在每一種編碼裡都解得出東西。
    const result = decodeBytes(utf8('sceneCode,durationSec\nS01,5'))
    expect(result.encoding).toBe('utf-8')
    expect(result.note).toBeNull()
  })

  it('空檔案不會炸', () => {
    expect(decodeBytes(new Uint8Array(0)).text).toBe('')
  })

  it('認不出來的時候要講，不要安靜地給一堆問號', () => {
    // 隨機位元組：哪一種都解不出像樣的中文。
    const bytes = new Uint8Array([0xff, 0x00, 0xfe, 0x01, 0x80, 0x81])
    const result = decodeBytes(bytes)
    expect(result.note).not.toBeNull()
  })
})

describe('檔名規格（Z185）', () => {
  it('認得出每一區，建議的關鍵字一定要認得', () => {
    for (const target of IMPORT_TARGETS) {
      const keyword = FILENAME_KEYWORDS[target.key][0]!
      expect(readFilename(`${keyword}.csv`).target, keyword).toBe(target.key)
    }
  })

  it('簡體檔名一樣認得', () => {
    expect(readFilename('分镜-EP001.csv').target).toBe('shots')
    expect(readFilename('世界观.md').target).toBe('world')
  })

  it('EP001 / ep1 / 第 3 集都是集號', () => {
    expect(readFilename('分鏡-EP001.csv').episodeNumber).toBe(1)
    expect(readFilename('分鏡 ep12.csv').episodeNumber).toBe(12)
    expect(readFilename('分鏡-第 3 集.csv').episodeNumber).toBe(3)
  })

  it('S01 不是集號，是場次', () => {
    /*
     * 混用的話，一個叫 `分鏡-S01.csv` 的檔案會被匯進第一集——而它可能是第八
     * 集的第一場。
     */
    const hints = readFilename('分鏡-S01.csv')
    expect(hints.episodeNumber).toBeNull()
    expect(hints.defaults).toEqual({ sceneCode: 'S01' })
  })

  it('集號與場次可以同時出現', () => {
    const hints = readFilename('分鏡-EP002-S03.csv')
    expect(hints.episodeNumber).toBe(2)
    expect(hints.defaults.sceneCode).toBe('S03')
  })

  it('劇本的場次填到它自己的欄位', () => {
    expect(readFilename('劇本-EP001-S02.csv').defaults).toEqual({ code: 'S02' })
  })

  it('兩個關鍵字時取比較長的那個', () => {
    expect(readFilename('小說-集數大綱.csv').target).toBe('episodes')
  })

  it('認不出來就回 null，不亂猜', () => {
    /*
     * 猜錯比猜不到糟：一個叫「第一集整理.csv」的檔案可能是任何東西，而把它
     * 猜成集數大綱然後蓋掉二十集的標題，是這個功能唯一能造成的嚴重傷害。
     */
    expect(readFilename('第一集整理.csv').target).toBeNull()
    expect(readFilename('未命名 (3).csv').target).toBeNull()
  })

  it('副檔名與路徑不參與判斷', () => {
    expect(readFilename('C:/下載/角色.json').target).toBe('characters')
    expect(readFilename('character.xlsx').target).toBe('characters')
  })

  it('規格文件列得出每一區與編碼', () => {
    const guide = filenameGuide()
    for (const target of IMPORT_TARGETS) {
      expect(guide).toContain(target.label)
      expect(guide).toContain(FILENAME_KEYWORDS[target.key][0]!)
    }
    expect(guide).toContain('UTF-8')
    expect(guide).toContain('Big5')
    expect(guide).toContain('GBK')
  })
})

/* -------------------------------------------------------------------------- */

describe('小說 Markdown 拆成集數＋章節（Z186）', () => {
  it('front-matter 的欄位會進集數', () => {
    const doc = parseNovelMarkdown(
      ['---', '標題: 三文錢的生意', '一句話: 用三文錢做出一疊酥香雞皮', '---', '', '正文開始。'].join('\n')
    )
    expect(doc.episode.title).toBe('三文錢的生意')
    expect(doc.episode.logline).toBe('用三文錢做出一疊酥香雞皮')
  })

  it('簡體的小節標題一樣認得', () => {
    /*
     * 模型用簡體回答是常態。「大纲」認不出來的症狀是整段大綱變成第一章的內
     * 文——它不報錯，看起來像檔案本來就那樣寫的。
     */
    const doc = parseNovelMarkdown(
      ['# 第一集', '', '## 大纲', '開場在東市。', '', '## 第一章', '天剛亮。'].join('\n')
    )
    expect(doc.episode.synopsis).toBe('開場在東市。')
    expect(doc.chapters).toHaveLength(1)
  })

  it('章節層級取出現最多次的那一層', () => {
    /*
     * 模型吐出來的層級不固定：有時 `#` 是書名、`##` 是章；有時 `#` 就是章。
     * 寫死任何一層都會在另一種情況下把整本書變成一章。
     */
    const doc = parseNovelMarkdown(
      ['# 書名', '', '## 第一章', '甲', '', '## 第二章', '乙', '', '## 第三章', '丙'].join('\n')
    )
    expect(doc.episode.title).toBe('書名')
    expect(doc.chapters.map((c) => c.title)).toEqual(['第一章', '第二章', '第三章'])
  })

  it('`#` 就是章的那種寫法也對', () => {
    const doc = parseNovelMarkdown(['# 第一章', '甲', '', '# 第二章', '乙'].join('\n'))
    expect(doc.chapters.map((c) => c.title)).toEqual(['第一章', '第二章'])
  })

  it('並列時取比較淺的那一層', () => {
    // `#` 與 `##` 各兩個：`#` 是章，`##` 是章裡的小節。反過來會把每章切成兩章。
    const doc = parseNovelMarkdown(
      ['# 第一章', '## 一', '甲', '## 二', '乙', '', '# 第二章', '丙'].join('\n')
    )
    expect(doc.chapters).toHaveLength(2)
    expect(doc.chapters[0]?.content).toContain('甲')
    expect(doc.chapters[0]?.content).toContain('乙')
  })

  it('比章更深的標題併回上一章，標題留著', () => {
    const doc = parseNovelMarkdown(
      ['# 第一章', '甲', '## 小節', '乙', '', '# 第二章', '丙'].join('\n')
    )
    expect(doc.chapters[0]?.content).toContain('## 小節')
    expect(doc.chapters[0]?.content).toContain('乙')
  })

  it('沒有任何標題就是一整章', () => {
    /*
     * 硬要從空行猜章節，會把對話之間的空行切成章。一份沒有標題的檔案確實就
     * 是一段正文。
     */
    const doc = parseNovelMarkdown('天剛亮，沈知味便被一陣叫賣聲吵醒了。\n\n她坐起身。')
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0]?.title).toBe('')
    expect(doc.chapters[0]?.content).toContain('坐起身')
  })

  it('程式碼圍欄裡的井字號不是標題', () => {
    const doc = parseNovelMarkdown(
      ['# 第一章', '甲', '```', '# 這不是標題', '```', '乙'].join('\n')
    )
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0]?.content).toContain('# 這不是標題')
  })

  it('front-matter 優先於內文標題', () => {
    const doc = parseNovelMarkdown(['---', '標題: 來自前言', '---', '# 來自內文'].join('\n'))
    expect(doc.episode.title).toBe('來自前言')
  })

  it('大綱那一節不會變成一章', () => {
    const doc = parseNovelMarkdown(
      ['## 大綱', '梗概在這。', '', '## 第一章', '甲', '', '## 第二章', '乙'].join('\n')
    )
    expect(doc.chapters.map((c) => c.title)).toEqual(['第一章', '第二章'])
    expect(doc.episode.synopsis).toBe('梗概在這。')
  })

  it('空檔案不會炸', () => {
    const doc = parseNovelMarkdown('')
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0]?.content).toBe('')
  })

  it('CRLF 也吃得下', () => {
    const doc = parseNovelMarkdown('# 第一章\r\n甲\r\n')
    expect(doc.chapters[0]?.content).toBe('甲')
  })
})

/* -------------------------------------------------------------------------- */

/**
 * 子代理審出來的那幾條，每一條一個測試（Z190）。
 *
 * 這些全部是「不報錯、但資料是錯的」那一類——所以沒有測試守著的話，下一次改
 * 動把它們改回去也不會有人知道。
 */
describe('子代理審出來的（Z190）', () => {
  const shots = importTarget('shots')
  const characters = importTarget('characters')
  const sheet = (headers: string[], rows: string[][]) => ({
    headers,
    rows,
    format: 'csv' as const,
  })

  it('負面提示詞不會被對到正向提示詞', () => {
    /*
     * 「提示詞」是「負向提示詞」的子字串，而它宣告在前面——照宣告順序取第一
     * 個命中的話，負面提示詞會寫進**正向**欄位，而正向是直接餵給生圖的。不
     * 報錯，要到出圖才看得出來。
     */
    expect(detectMapping(['姓名', '反向提示詞'], characters)).toEqual([
      'name',
      'negativePrompt',
    ])
    expect(detectMapping(['姓名', '負向提示詞'], characters)).toEqual([
      'name',
      'negativePrompt',
    ])
    expect(detectMapping(['場次', '負向提示詞'], shots)).toEqual(['sceneCode', 'negativePrompt'])
  })

  it('「場景」不會被對到「場次代號」', () => {
    // `地點` 先認領 `location` 之後，`場景` 去撞 `sceneCode` 的別名「場景代號」。
    const mapping = detectMapping(['地點', '場景'], shots)
    expect(mapping[0]).toBe('location')
    expect(mapping[1]).not.toBe('sceneCode')
  })

  it('不在別名清單裡的負向欄名，寧可不對也不要對到正向', () => {
    /*
     * 補別名只能擋掉想得到的那幾種寫法。`負面的提示詞`、`排除提示詞` 這種沒
     * 人列得完，而它們全都包含「提示詞」——所以沒有守衛的話，一律落進**正
     * 向**欄位，而正向是直接餵給生圖的。
     *
     * 正確的結果是 null：讓人自己選一次，比默默餵錯好。
     */
    for (const header of ['負面的提示詞', '排除提示詞', '不要的 negative 提示詞']) {
      const mapping = detectMapping([header], shots)
      expect(mapping[0], header).not.toBe('prompt')
    }
  })

  it('正向提示詞自己還是對得上', () => {
    // 修法是「取最長命中」，所以不能把原本對的也改壞。
    expect(detectMapping(['生圖提示詞'], shots)).toEqual(['prompt'])
    expect(detectMapping(['提示詞'], shots)).toEqual(['prompt'])
  })

  it('歐式小數與會計負數不會變成別的數字', () => {
    /*
     * 原本「把逗號與空白一起當千分位拿掉」，於是 `1 200,50` 變成 120050
     * ——差一百倍，而且沒有任何提醒。
     */
    const expenses = importTarget('expenses')
    const run = (value: string) =>
      mapRows(
        sheet(['項目', '金額'], [['甲', value]]),
        ['description', 'amount'],
        expenses,
        EMPTY
      )

    expect(run('NT$1,200.50').rows[0]?.amount).toBe(1200.5)
    expect(run('1,200.50').rows[0]?.amount).toBe(1200.5)

    /*
     * 歐式寫法（空白當千分位、逗號當小數點）**不猜**：`1 200,50` 可能是
     * 1200.5，也可能是誰少打了一個字。原本的做法把它變成 120050——差一百
     * 倍，而且沒有任何提醒。現在它是一個講得出口的錯誤。
     */
    expect(run('1 200,50').rows).toHaveLength(0)
    expect(run('1 200,50').issues[0]?.message).toContain('看不出是數字')

    /*
     * 會計的負數括號認得出來，而負的金額會被擋下來——把 -500 夾成 0 是在虛
     * 構一個數字，而 0 看起來完全正常。
     */
    expect(run('(500)').rows).toHaveLength(0)
    expect(run('(500)').issues[0]?.message).toContain('負數')
  })

  it('看不懂的數字要報錯，不是猜一個', () => {
    const run = (value: string) =>
      mapRows(sheet(['秒數'], [[value]]), ['durationSec'], shots, EMPTY)

    for (const bad of ['3-5', '1.2.3', '12e3', '大概五秒']) {
      const result = run(bad)
      expect(result.rows, bad).toHaveLength(0)
      expect(result.issues[0]?.level, bad).toBe('error')
    }
  })

  it('整列只填了一個認不得的狀態，不會被當成空行吞掉', () => {
    /*
     * 列舉值認不得時不放值進 record，而「整列空白」的判斷看的是 record——於
     * 是那一列被跳過，而訊息寫著「會用預設值」。說的跟做的不一樣。
     */
    const result = mapRows(sheet(['狀態'], [['審核中']]), ['status'], shots, EMPTY)
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toEqual([])
    expect(result.issues[0]?.message).toContain('不是狀態的選項')
  })

  it('真的空白的那一列還是要跳過', () => {
    // 上面那條不能把「尾端空行」也救回來。
    const result = mapRows(sheet(['狀態'], [['']]), ['status'], shots, EMPTY)
    expect(result.rows).toHaveLength(0)
    expect(result.skipped).toEqual([1])
  })

  it('一欄位址誇張的 Excel 不會把程序撐爆', () => {
    /*
     * 欄位址是從字母算的，而 `AAAAAA1` 算出來是三億——然後那一列會被配成一個
     * 三億筆的陣列，Node 直接 OOM。那是 FATAL ERROR 不是例外，try/catch 救
     * 不了。幾百 bytes 的檔案就做得到。
     */
    const file = readFileSync('tests/fixtures/column-bomb.xlsx')
    const before = process.memoryUsage().heapUsed
    const sheetOut = parseXlsx(file)
    const after = process.memoryUsage().heapUsed

    expect(sheetOut.headers.length).toBeLessThanOrEqual(16384)
    // 多配個幾百 MB 的話這一條會紅。
    expect(after - before).toBeLessThan(200 * 1024 * 1024)
  })

  it('壞掉的 zip 丟的是看得懂的錯，不是 Node 的內部訊息', () => {
    const broken = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(60, 0),
    ])
    expect(() => parseXlsx(broken)).toThrow(ImportParseError)
  })

  it('HTML 的超範圍實體不會丟 RangeError', () => {
    // `String.fromCodePoint(0x110000)` 丟的是 Node 的英文內部訊息。
    const parsed = parseSheet(
      '<table><tr><td>a</td></tr><tr><td>&#x110000;&#999999999999;</td></tr></table>'
    )
    expect(parsed.rows[0]?.[0]).toContain('&#x110000;')
  })

  it('簡體 CSV 不會被判成 Big5', () => {
    /*
     * 解錯的那一串落點也在常用漢字區（「賒醱鏡扴」每個字都算一分），所以只
     * 數漢字會平分——而平分時穩定排序讓先推入的 Big5 永遠贏。簡體 Windows 的
     * Excel 存出來的 CSV 因此一律亂碼。
     */
    const gbk = gbkBytes('场次,景别,画面描述\nS01,中景,沈知味推开门，灶上的火还没熄。')
    const result = decodeBytes(gbk)
    expect(result.text).toContain('画面描述')
    expect(result.text).toContain('沈知味推开门')
  })

  it('繁體 Big5 的也還是對的', () => {
    const big5 = big5Bytes('場次,景別,畫面描述\nS01,中景,沈知味推開門。')
    const result = decodeBytes(big5)
    expect(result.text).toContain('畫面描述')
  })
})

/* Node 內建的轉碼器只解不編，所以用一張最小的對照表自己編。 */
function encodeWith(text: string, label: 'big5' | 'gb18030'): Uint8Array {
  const decoder = new TextDecoder(label)
  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x80) {
      out.push(code)
      continue
    }
    let found = false
    for (let lead = 0x81; lead <= 0xfe && !found; lead += 1) {
      for (let trail = 0x40; trail <= 0xfe && !found; trail += 1) {
        if (decoder.decode(new Uint8Array([lead, trail])) === char) {
          out.push(lead, trail)
          found = true
        }
      }
    }
    if (!found) throw new Error(`編不出「${char}」(${label})`)
  }
  return new Uint8Array(out)
}

const big5Bytes = (text: string) => encodeWith(text, 'big5')
const gbkBytes = (text: string) => encodeWith(text, 'gb18030')
