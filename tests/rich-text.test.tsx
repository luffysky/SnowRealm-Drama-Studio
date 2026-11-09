import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RichText } from '@/components/assistant/RichText'

/**
 * 模型回的那種 markdown-ish 文字（Z198）。
 *
 * 守的是兩件**看不出來**的事：
 *
 * 1. **編號不可以跳回 1。** 模型常寫「1. 第一點」後面接幾個 `-` 子項，再寫
 *    「2. 第二點」——子項會把前一個 `<ol>` 收掉，而新的 `<ol>` 預設從 1 開始。
 *    問它「用三點講」然後看到三個第一點，看起來像它壞了。實際發生過。
 * 2. **不可以產生 HTML。** 這些文字是模型輸出，而同一頁也在顯示小說正文。
 *    `dangerouslySetInnerHTML` 在這裡等於把一條執行路徑交出去。
 */
const html = (text: string, size?: 'sm' | 'lg') =>
  renderToStaticMarkup(<RichText text={text} size={size} />)

describe('RichText（Z198）', () => {
  it('編號接著模型寫的號碼，不會每一段都從 1 重來', () => {
    const text = [
      '1. 第一點',
      '- 依據：甲',
      '2. 第二點',
      '- 依據：乙',
      '3. 第三點',
    ].join('\n')

    const out = html(text)
    // 三個有序清單，第二、三個要帶 start。
    expect(out.match(/<ol/g)).toHaveLength(3)
    expect(out).toContain('start="2"')
    expect(out).toContain('start="3"')
    // 第一個不必帶——`start="1"` 是預設值，寫出來只是雜訊。
    expect(out).not.toContain('start="1"')
  })

  it('`1.` 跟 `-` 不會混進同一個清單', () => {
    const out = html('1. 甲\n- 乙')
    expect(out.match(/<ol/g)).toHaveLength(1)
    expect(out.match(/<ul/g)).toHaveLength(1)
  })

  it('粗體與行內程式碼變成標籤，不是星號', () => {
    const out = html('這是 **重點**，還有 `code`。')
    expect(out).toContain('<strong')
    expect(out).toContain('<code')
    expect(out).not.toContain('**')
  })

  it('不產生任何 HTML：模型寫的標籤只會是文字', () => {
    /*
     * 這一條是整支檔案裡最要緊的。`RichText` 組的是 React 節點，所以模型寫
     * `<img onerror=…>` 出來也只會被跳脫成字。
     */
    const out = html('<img src=x onerror="alert(1)"> 與 <script>alert(2)</script>')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;img')
  })

  it('兩個尺寸真的不一樣', () => {
    expect(html('一句話', 'sm')).toContain('text-[13px]')
    expect(html('一句話', 'lg')).toContain('text-[15px]')
  })

  it('空白行是段落分隔，連續空白行只算一個', () => {
    const out = html('上面\n\n\n\n下面')
    // 四個換行只產生一個間隔。
    expect(out.match(/class="h-2"/g)).toHaveLength(1)
  })
})
