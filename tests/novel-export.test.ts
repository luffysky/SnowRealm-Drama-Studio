import { describe, expect, it } from 'vitest'
import { htmlToText } from '@/lib/novel-export'
import { createZip } from '@/lib/zip'

/**
 * Export plumbing.
 *
 * `htmlToText` is where a novel export goes wrong silently: get the block
 * handling even slightly off and 40,000 characters arrive as one paragraph,
 * which still "works" and is unreadable.
 */
describe('htmlToText', () => {
  it('turns block ends into paragraph breaks', () => {
    expect(htmlToText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n\n第二段')
  })

  it('keeps a line break as a single newline', () => {
    expect(htmlToText('<p>上句<br>下句</p>')).toBe('上句\n下句')
  })

  it('decodes &amp; last, so &amp;lt; does not become a real tag', () => {
    // Decoding &amp; first would turn this into "&lt;" and then into "<".
    expect(htmlToText('<p>&amp;lt;b&amp;gt;</p>')).toBe('&lt;b&gt;')
  })

  it('drops script and style content rather than printing it', () => {
    expect(htmlToText('<p>正文</p><script>alert(1)</script>')).toBe('正文')
  })

  it('collapses runs of blank lines', () => {
    expect(htmlToText('<p>一</p><p></p><p></p><p>二</p>')).toBe('一\n\n二')
  })

  it('renders a horizontal rule as a scene break', () => {
    expect(htmlToText('<p>一</p><hr><p>二</p>')).toBe('一\n\n* * *\n\n二')
  })
})

describe('createZip', () => {
  it('writes a readable archive with the expected signatures', () => {
    const zip = createZip([
      { path: 'mimetype', data: 'application/epub+zip', store: true },
      { path: 'OEBPS/ch1.xhtml', data: '<html><body>內文</body></html>' },
    ])

    // Local file header, then the end-of-central-directory record.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.subarray(zip.length - 22).readUInt32LE(0)).toBe(0x06054b50)
    expect(zip.subarray(zip.length - 22).readUInt16LE(10)).toBe(2)
  })

  it('stores `mimetype` uncompressed at a fixed offset', () => {
    // A reader looks for the magic string here; deflating it makes the EPUB
    // unopenable with no useful error.
    const zip = createZip([{ path: 'mimetype', data: 'application/epub+zip', store: true }])

    expect(zip.readUInt16LE(8)).toBe(0) // method 0 = store
    expect(zip.subarray(38, 58).toString('utf8')).toBe('application/epub+zip')
  })

  it('falls back to storing when deflate would make the entry bigger', () => {
    const zip = createZip([{ path: 'a', data: 'x' }])

    expect(zip.readUInt16LE(8)).toBe(0)
  })

  it('marks filenames as UTF-8 so CJK survives', () => {
    const zip = createZip([{ path: '一灶見山河.txt', data: 'x' }])

    // Bit 11 of the general-purpose flags.
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800)
  })
})

/**
 * 章名與集名重複時不印章名。
 *
 * 一集一章是這裡的常態，而拆章工具把兩個名字設成同一個來源，所以匯出
 * 會印「第 1 集　三文錢的生意」再緊接著「── 三文錢的生意 ──」。
 */
function showsChapterTitle(
  episode: { title: string; chapters: unknown[] },
  title: string
): boolean {
  const name = title.trim()
  if (!name) return false
  if (episode.chapters.length > 1) return true
  return name !== episode.title.trim()
}

describe('showsChapterTitle', () => {
  const one = (title: string) => ({ title, chapters: [1] })
  const many = (title: string) => ({ title, chapters: [1, 2] })

  it('hides a chapter title that repeats the episode title', () => {
    expect(showsChapterTitle(one('三文錢的生意'), '三文錢的生意')).toBe(false)
  })

  it('ignores surrounding whitespace when comparing', () => {
    expect(showsChapterTitle(one('三文錢的生意'), '  三文錢的生意 ')).toBe(false)
  })

  it('shows it when the chapter says something different', () => {
    expect(showsChapterTitle(one('三文錢的生意'), '楔子')).toBe(true)
  })

  it('always shows it when an episode has several chapters', () => {
    // Two chapters with no headings between them run together as one block.
    expect(showsChapterTitle(many('三文錢的生意'), '三文錢的生意')).toBe(true)
  })

  it('hides an empty title rather than printing an empty heading', () => {
    expect(showsChapterTitle(one('三文錢的生意'), '   ')).toBe(false)
    expect(showsChapterTitle(many('三文錢的生意'), '')).toBe(false)
  })
})

/**
 * 朗讀的斷句（Z100 前置）。
 *
 * 長字串在 Chrome 會被截斷，而且一段話一旦開始唸就沒辦法從中間接續——
 * 所以要切。切在標點後面是因為那個標點正是合成器用來換氣的依據，
 * 丟掉它整段會黏成一條線唸完。
 */
