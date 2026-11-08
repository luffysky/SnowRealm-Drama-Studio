import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSkippedTag } from '@/lib/use-script-conversion'
import {
  convertParagraphs,
  convertScript,
  DEFAULT_SCRIPT,
  foldForCompare,
  isScriptPreference,
  toSimplified,
  toTraditional,
} from '@/lib/chinese'

/**
 * 繁簡轉換（Z135）。
 *
 * 這份測試的重點不是「會不會轉」，是**單字對照表會錯的那幾組**。那種錯讀
 * 起來像錯字、不像壞掉，所以不會有人回報，只會覺得這個軟體很粗糙。
 */

describe('同一個繁體字對到不同簡體字', () => {
  it('發：頭髮 vs 發現', () => {
    expect(toSimplified('頭髮')).toBe('头发')
    expect(toSimplified('發現')).toBe('发现')
  })

  it('著：著火 vs 顯著', () => {
    expect(toSimplified('著火')).toBe('着火')
    expect(toSimplified('顯著')).toBe('显著')
  })

  it('乾：乾淨要轉，乾坤不轉', () => {
    expect(toSimplified('乾淨')).toBe('干净')
    expect(toSimplified('乾坤')).toBe('乾坤')
  })
})

describe('不該被轉掉的東西', () => {
  it('沈作為姓氏不會變成沉', () => {
    // 主角叫沈知味。轉成「沉知味」會是整本書裡最刺眼的錯字。
    expect(toSimplified('沈知味')).toBe('沈知味')
  })

  it('英文、數字、標點原封不動', () => {
    expect(toSimplified('EP001「三文錢」2026-11-05')).toBe('EP001「三文钱」2026-11-05')
  })

  it('空字串不會爆', () => {
    expect(toSimplified('')).toBe('')
    expect(toTraditional('')).toBe('')
  })
})

describe('convertScript', () => {
  it('原文就是原封不動', () => {
    expect(convertScript('頭髮', 'original')).toBe('頭髮')
  })

  it('簡體與繁體各自轉', () => {
    expect(convertScript('頭髮', 'simplified')).toBe('头发')
    expect(convertScript('头发', 'traditional')).toBe('頭髮')
  })

  it('預設是簡體', () => {
    expect(DEFAULT_SCRIPT).toBe('simplified')
  })
})

describe('convertParagraphs', () => {
  it('一段一段轉，不靠分隔符號', () => {
    // 用分隔符號接起來再切開，需要一個正文裡不可能出現的字元——沒有這種字元。
    const source = ['頭髮', '發現', '著火']
    expect(convertParagraphs(source, 'simplified')).toEqual(['头发', '发现', '着火'])
  })

  it('原文會回一份新的陣列，不會把來源改掉', () => {
    const source = ['頭髮']
    const out = convertParagraphs(source, 'original')
    expect(out).toEqual(source)
    expect(out).not.toBe(source)
  })

  it('空段落留著——那是間隔，不是沒有內容', () => {
    expect(convertParagraphs(['甲', '', '乙'], 'simplified')).toEqual(['甲', '', '乙'])
  })
})

describe('isScriptPreference', () => {
  it('只認那三個值', () => {
    expect(isScriptPreference('simplified')).toBe(true)
    expect(isScriptPreference('traditional')).toBe(true)
    expect(isScriptPreference('original')).toBe(true)
    expect(isScriptPreference('zh-CN')).toBe(false)
    expect(isScriptPreference(null)).toBe(false)
  })
})

describe('來回一趟', () => {
  it('繁 → 簡 → 繁 大多數字回得來，但不是全部', () => {
    /*
     * 刻意把這件事寫成測試而不是註解：簡轉繁是一對多，`干` 可能是
     * 乾／幹／干。所以存起來的正文永遠不轉——轉過的字回不來。
     */
    const original = '乾坤'
    const round = toTraditional(toSimplified(original))
    expect(round).toBe('乾坤')

    // 而這一組就回不來了。
    const lossy = toTraditional(toSimplified('頭髮'))
    expect(lossy).toBe('頭髮')
  })
})

describe('哪些標籤不轉（Z156）', () => {
  /*
   * 下拉選單要跟著設定走：繁體拉下來是繁體，簡體拉下來是簡體。
   *
   * `SELECT` 本來跟 `INPUT`／`TEXTAREA` 一起被跳過，但那三個不是同一回事
   * ——輸入框裡是使用者正在打的字，`<option>` 的文字是我們寫死的標籤。結果
   * 是整頁簡體中間插著一個繁體的下拉（分鏡工作台一頁有七個）。
   *
   * 這條測試盯的是它不要被加回去。那種錯沒有人會回報，只會覺得粗糙。
   */
  it('下拉選單的文字要轉', () => {
    expect(isSkippedTag('SELECT')).toBe(false)
    expect(isSkippedTag('OPTION')).toBe(false)
  })

  it('使用者正在打字的地方不要碰', () => {
    expect(isSkippedTag('INPUT')).toBe(true)
    expect(isSkippedTag('TEXTAREA')).toBe(true)
  })

  it('不是文章的東西不要碰', () => {
    expect(isSkippedTag('SCRIPT')).toBe(true)
    expect(isSkippedTag('STYLE')).toBe(true)
    expect(isSkippedTag('CODE')).toBe(true)
    expect(isSkippedTag('PRE')).toBe(true)
  })

  it('比對不分大小寫——`tagName` 是大寫，但呼叫端不該需要知道', () => {
    expect(isSkippedTag('input')).toBe(true)
    expect(isSkippedTag('select')).toBe(false)
  })
})

/**
 * 上傳簡體小說，閱讀器選「繁體」轉不過來 (Z172).
 *
 * 原本的設計裡「繁體」的意思是**不要轉**，因為它假設原文一定是繁體——而那對
 * 我們自己寫的介面標籤成立，對上傳進來的小說不成立。
 */
describe('簡 → 繁（Z172）', () => {
  it('簡體正文選繁體，要真的轉過來', () => {
    expect(convertScript('头发乱了', 'traditional')).toBe('頭髮亂了')
    expect(convertScript('他发现了', 'traditional')).toBe('他發現了')
  })

  it('繁體正文選繁體，要一個字都不動', () => {
    for (const line of ['許山河推開門', '樹幹', '乾淨', '著火', '顯著', '沈知味']) {
      expect(convertScript(line, 'traditional')).toBe(line)
    }
  })

  it('繁體段落裡夾著一個「干」，不可以被改成「幹」', () => {
    /*
     * 這一條才是防護真正擋的情況，而第一版我沒測到。
     *
     * 上面那組字全是繁體獨有字，cn→tw 本來就不會動它們——所以把防護整段拿
     * 掉，那一條測試還是綠的。真正會出事的是**混排**：一段繁體正文裡出現
     * 一個 `干`（繁體裡是正當的字），無條件跑 cn→tw 會依詞組把它改成
     * `幹`，而那是寫死的字被換掉。
     *
     * 這不是假想情況，但主角換人了：小說原文是簡體（暖寶寫的），而**介面上
     * 幾百個寫死的標籤是繁體**，它們每一段都會被這個方向掃過。見下面那一組
     * 拿真的 src/ 來量的測試。
     */
    const line = '他干了一件大事，許山河推開門'
    expect(convertScript(line, 'traditional')).toBe(line)
    expect(convertScript('干，這鍋麵糊了', 'traditional')).toBe('干，這鍋麵糊了')
  })

  it('繁 → 簡 不受影響', () => {
    expect(convertScript('頭髮亂了', 'simplified')).toBe('头发乱了')
    expect(convertScript('沈知味', 'simplified')).toBe('沈知味')
  })

  it('原文模式兩個方向都不轉', () => {
    expect(convertScript('头发', 'original')).toBe('头发')
    expect(convertScript('頭髮', 'original')).toBe('頭髮')
  })

  it('convertParagraphs 走的是同一條路，不是第二份實作', () => {
    // 一段繁、一段簡，混在同一章裡——繁的那段不該被動到。
    // 繁的那段刻意夾一個 `干`，不然兩種實作的結果一樣，這條就測不到東西。
    expect(
      convertParagraphs(['他干了一件大事，許山河推開門', '头发乱了'], 'traditional')
    ).toEqual(['他干了一件大事，許山河推開門', '頭髮亂了'])
  })
})

/**
 * 整個介面也要能轉成繁體，而那個方向會掃過寫死的繁體標籤 (Z172).
 *
 * `ScriptProvider` 原本只傳一個布林進 `useScriptConversion`，意思是「要不要轉
 * 成簡體」——方向寫死，所以選「繁體」等於把轉換關掉。畫面上絕大多數的中文是
 * 從資料庫來的簡體（場次內容、分鏡描述、角色小傳、搜尋結果），於是整個介面停
 * 在簡體。
 *
 * 補上另一個方向的代價是：它會掃過**我們自己寫死的繁體標籤**。這一組測試拿真
 * 的 `src/` 去量那個代價，而不是憑印象講「應該還好」。
 *
 * 量出來的數字（3,630 段含漢字的介面文字）：無防護會改寫 42 段，有防護 10
 * 段。我原本以為是「幾百段降到個位數」，不是——而真正要緊的不是數量，是那 32
 * 段裡**有真的錯字**，見下面第二條。
 */
describe('介面寫死的繁體標籤（Z172）', () => {
  /** 把 src/ 底下的中文挖出來，註解不算——它們不會顯示給任何人。 */
  function uiStrings(): Set<string> {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const at = join(dir, name)
        if (statSync(at).isDirectory()) walk(at)
        else if (/\.tsx?$/.test(name)) files.push(at)
      }
    }
    walk('src')

    const out = new Set<string>()
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const raw of code.match(/[\u3400-\u9fff\u3000-\u303f\uff01-\uff5e0-9A-Za-z %-]+/g) ?? []) {
        const chunk = raw.trim()
        if (chunk && /[\u3400-\u9fff]/.test(chunk)) out.add(chunk)
      }
    }
    return out
  }

  /*
   * 防護到底換來了什麼，用數字講——而這個數字是量出來的，不是估的.
   *
   * 斷言寫成一個比例與一個上限，不對死一張清單：清單會在任何人加一句帶
   * 「台」的介面文字時變紅，而那不是壞事發生，只是多了一句話。比例則只有在
   * 防護真的被拿掉時才會跨過去（拿掉之後兩個數字相等，比例變成 1）。
   */
  it('防護讓被改寫的介面文字少掉四分之三', () => {
    const strings = [...uiStrings()]
    expect(strings.length).toBeGreaterThan(2000)

    const guarded = strings.filter((text) => convertScript(text, 'traditional') !== text)
    const bare = strings.filter((text) => toTraditional(text) !== text)

    expect(guarded.length).toBeLessThan(20)
    expect(bare.length).toBeGreaterThan(guarded.length * 3)
  })

  /*
   * 防護擋下來的不是「異體字之爭」，是**錯字**.
   *
   * 我第一輪的理解是錯的：我以為代價只有 `台`→`臺` 那種「兩個都是繁體、只是
   * 比較正式」的寫法，所以講了一句「仍然是正確的繁體」。拿真的 src/ 去掃才看
   * 到 `儀表板`→`儀錶板`、`只影響`→`隻影響`、`說明了`→`說明瞭`、`游標`→
   * `遊標`——那些是沒有人會這樣寫的字。
   *
   * 而這些錯**不是轉換器的毛病**：餵它真的簡體，它答得對（`仪表板` →
   * `儀表板`、`说明了` → `說明了`、`游标` → `游標`）。錯是來自把**已經是繁
   * 體**的字再餵一次 cn→tw，於是 OpenCC 的台灣詞組層把一個本來就對的字
   * 「校正」成另一個字。那正是防護唯一要擋的事。
   *
   * 所以這一條兩邊都斷言：無防護會壞成什麼樣，有防護是零動作。只測後者的
   * 話，防護拿掉它還是綠的——因為大部分繁體字 cn→tw 本來就不會動（那是一張
   * 簡體字的對照表），所以「繁體進去、繁體出來」在這些字串上是巧合，不是保
   * 證。這跟上面 `干`→`幹` 那一條是同一個失敗模式。
   */
  it('無防護會把對的繁體字改成錯字', () => {
    const cases: [string, string][] = [
      ['工作室儀表板', '工作室儀錶板'],
      ['只影響顯示，不換算儲存值。', '隻影響顯示，不換算儲存值。'],
      ['插在游標處', '插在遊標處'],
      ['這台裝置沒有裝語音引擎', '這臺裝置沒有裝語音引擎'],
      ['台詞', '臺詞'],
    ]

    for (const [label, mangled] of cases) {
      expect(toTraditional(label)).toBe(mangled)
      expect(convertScript(label, 'traditional')).toBe(label)
    }
  })

  /*
   * 餵它真的簡體，它答得對——所以上面那些錯不是換個轉換器就能解決的.
   *
   * 留著這一條是為了擋一種修法：有人看到 `儀錶板` 就去換 OpenCC 的目標字形。
   * 換過了，`to: 't'` 多出 `人群`→`人羣`，`to: 'hk'` 多出 `說明了`→`説明
   * 了`，兩個都更糟。`tw` 是量過之後最好的那一個。
   */
  it('真的簡體進去，答案是對的', () => {
    expect(convertScript('仪表板', 'traditional')).toBe('儀表板')
    expect(convertScript('说明了', 'traditional')).toBe('說明了')
    expect(convertScript('游标', 'traditional')).toBe('游標')
    // 台灣用字，`to: 'tw'` 才會這樣答（`t` 與 `hk` 都給 `着火`）。
    expect(convertScript('着火', 'traditional')).toBe('著火')
    // 而 `tw` 不會把 `人群` 改成 `人羣`——那是 `t` 與 `hk` 的毛病。
    expect(convertScript('人群', 'traditional')).toBe('人群')
  })

  it('常見的介面標籤一個字都不動', () => {
    /*
     * 從 src/ 抄的真字串，不是我編的。
     *
     * 這一條跟上面那個數字的斷言是兩種強度：上面保證「沒有大規模走樣」，這
     * 裡保證「使用者天天看到的那幾顆按鈕沒有走樣」。
     */
    for (const label of [
      '儲存',
      '新增場次',
      '匯入小說',
      '角色',
      '分鏡',
      '集數',
      '預估片長',
      '製作進度',
      '待確認',
      '已採用',
      '素材庫',
      '定稿鎖',
      '沈知味',
      '一灶見山河',
    ]) {
      expect(convertScript(label, 'traditional')).toBe(label)
    }
  })

  /*
   * 唯一一個會真的錯的，是切換鍵自己.
   *
   * 「简体」那兩個字沒有繁體獨有字，所以防護放它過去，而 cn→tw 會把它變成
   * 「簡體」——那顆按鈕於是變成「繁體 / 簡體」，兩邊都是繁體，沒有人看得出
   * 哪一邊是哪一邊。
   *
   * 擋它的不是 `chinese.ts`，是 DOM 那一支的 `data-script-keep`。這裡測不到
   * DOM（測試跑在 node 環境，沒有 jsdom），所以退一步測**標記還在**：兩顆切
   * 換鍵各自所在的檔案裡必須有那個屬性。
   *
   * 讀原始碼當測試不漂亮，但這一條的失敗模式是「按鈕上的字變成另一邊的
   * 字」，沒有人會回報，只會覺得這個軟體很怪。
   */
  it('「简体」會被轉掉，所以切換鍵必須標 data-script-keep', () => {
    expect(convertScript('简体', 'traditional')).toBe('簡體')

    for (const file of [
      'src/components/studio/StudioShell.tsx',
      'src/components/studio/NovelReader.tsx',
    ]) {
      expect(readFileSync(file, 'utf8')).toContain('data-script-keep')
    }
  })
})

/**
 * 打名字確認的那個比對，兩邊要折到同一個點 (Z139 → Z174).
 *
 * Z139 當初修的症狀是「照著畫面打反而不給過」。Z172 讓繁體模式真的會轉之後，
 * 原本的折法（兩邊都折成簡體）把那個症狀**原封不動搬到另一邊**——而這一組測
 * 試就是用那個搬過去的案例寫的。
 */
describe('foldForCompare（Z174）', () => {
  it('照著畫面打的繁體，要跟資料庫裡的簡體相符', () => {
    const stored = '熏香'
    const shown = convertScript(stored, 'traditional')

    // 先確認這個案例是真的（不是我編的）：轉繁之後字變了。
    expect(shown).toBe('薰香')

    expect(foldForCompare(shown, 'traditional')).toBe(
      foldForCompare(stored, 'traditional')
    )
  })

  it('「兩邊都折成簡體」在這個案例上不夠——這就是舊做法壞掉的地方', () => {
    /*
     * 這一條守的是**理由**，不只是結果。
     *
     * 沒有它的話，有人把 `foldForCompare` 改回單純的 `toSimplified` 也不會變
     * 紅——上面那一條在大多數字上本來就會過。
     */
    expect(toSimplified('薰香')).not.toBe(toSimplified('熏香'))
  })

  it('簡體模式下的行為跟以前一樣', () => {
    expect(foldForCompare('頭髮', 'simplified')).toBe('头发')
    expect(foldForCompare('头发', 'simplified')).toBe('头发')
  })

  it('原文模式也折成簡體，所以打哪一種字形都收', () => {
    // `original` 不轉顯示，但比對還是要寬：畫面上是簡體，使用者打繁體也該過。
    expect(foldForCompare('頭髮', 'original')).toBe('头发')
    expect(foldForCompare('头发', 'original')).toBe('头发')
  })

  it('是等冪的——折過的再折一次還是自己', () => {
    for (const preference of ['original', 'simplified', 'traditional'] as const) {
      for (const text of ['熏香', '薰香', '头发', '頭髮', '沈知味']) {
        const once = foldForCompare(text, preference)
        expect(foldForCompare(once, preference)).toBe(once)
      }
    }
  })
})
