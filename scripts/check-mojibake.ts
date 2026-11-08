/**
 * 有沒有中文被存成雙重編碼（Z196）。
 *
 *     npx tsx scripts/check-mojibake.ts
 *
 * `CallPanel.tsx` 的通話覆蓋層在正式站上顯示 `ç­å°æ¹æ¥èµ·⋯`（應為
 * 「等對方接起⋯」），音量滑桿的 `sr-only` 標籤是 `éè©±é³é`（應為
 * 「通話音量」）。兩行都在磁碟上就是壞的——不是終端機的問題。
 *
 * 這種字**人不會發現**：它看起來像亂碼，而我們每天在終端機裡看到的亂碼有一半
 * 是編碼設定造成的假象，所以真的壞掉的那幾行會被當成假象放過去。typecheck 不
 * 管、lint 不管、測試不管——沒有任何一關看字串裡的字長什麼樣子。
 *
 * ## 判法
 *
 * UTF-8 的位元組被當成 Latin-1 讀進來的話，每個中文字會變成兩三個 U+0080–
 * U+00FF 的字母。把那一串**倒推回去**（encode latin-1 → decode utf-8），如果
 * 原本沒有中文、倒推之後有，那就是這個病。
 *
 * 反過來不會誤判：正常的中文行一開始就被跳過，而正常的西歐字母行倒推時多半
 * 會丟 UnicodeDecodeError，少數僥倖解得開的也解不出漢字。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src', 'scripts', 'tests']
const EXTENSIONS = /\.(tsx?|mjs|css|md)$/
const SKIP = new Set(['node_modules', '.next', '.git', 'dist'])

const hasHan = (text: string) => /[一-鿿]/.test(text)

/** 倒推回原本的位元組再當 UTF-8 讀。解不開就回 null。 */
function undo(line: string): string | null {
  const bytes = new Uint8Array(line.length)
  for (let i = 0; i < line.length; i += 1) {
    const code = line.charCodeAt(i)
    if (code > 0xff) return null
    bytes[i] = code
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (EXTENSIONS.test(entry)) yield full
  }
}

type Hit = { file: string; line: number; was: string; should: string }

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (hasHan(line)) return
        const fixed = undo(line)
        if (fixed && hasHan(fixed)) {
          hits.push({ file, line: index + 1, was: line.trim(), should: fixed.trim() })
        }
      })
    }
  }
  return hits
}

/**
 * 這支工具自己會不會壞。
 *
 * 餵它一行真的壞掉的字串（「通話音量」的雙重編碼），抓不到就直接說工具壞了，
 * 不要報平安——這跟 `check-links.ts` 的自我檢查同一個規矩。
 */
function selfTest(): boolean {
  const broken = 'é\u0080\u009aè©±é\u009f³é\u0087\u008f'
  const fixed = undo(broken)
  if (fixed !== '通話音量') {
    console.log(`  ✗ 這支工具壞了：倒推「通話音量」得到的是 ${JSON.stringify(fixed)}`)
    return false
  }
  // 正常的中文與正常的英文都不可以被當成壞的。
  for (const good of ['通話音量', 'const label = "volume"', '// 這一行是好的']) {
    if (!hasHan(good)) {
      const back = undo(good)
      if (back && hasHan(back)) {
        console.log(`  ✗ 這支工具壞了：${JSON.stringify(good)} 是好的卻被誤報`)
        return false
      }
    }
  }
  return true
}

if (!selfTest()) process.exit(1)

const hits = scan()
if (hits.length === 0) {
  console.log('  ✓ 沒有雙重編碼的中文（自我檢查通過）')
  process.exit(0)
}

console.log(`  ✗ ${hits.length} 行中文被存成雙重編碼：\n`)
for (const hit of hits) {
  console.log(`      ${hit.file}:${hit.line}`)
  console.log(`        現在是  ${hit.was.slice(0, 80)}`)
  console.log(`        應該是  ${hit.should.slice(0, 80)}\n`)
}
process.exit(1)
