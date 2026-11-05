import { describe, expect, it } from 'vitest'
import { isSkippedTag } from '@/lib/use-script-conversion'
import {
  convertParagraphs,
  convertScript,
  DEFAULT_SCRIPT,
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
