/**
 * The assistant's reply, rendered.
 *
 * It writes markdown-ish prose — `**粗體**`, `` `程式碼` ``, bullet lines,
 * the occasional heading — and the chat bubble rendered all of that as
 * literal asterisks. This is a deliberately small subset rather than a
 * markdown library: the input is a model's output, and the less of it that
 * turns into markup, the smaller the blast radius.
 *
 * Builds React nodes, never HTML. `dangerouslySetInnerHTML` on text that came
 * from a model, in a page that also shows the novel's own prose, is how a
 * reply ends up executing something.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * `lg` 是給「拿來讀的那種頁面」用的（編劇助手的回答）。
 *
 * 助理的聊天泡泡留在 `sm`：那裡一次出現好幾則，而且旁邊就是對話串，放大之後
 * 一句話就佔掉半個面板。同一份渲染器、兩個尺寸，比抄第二份好。
 */
type Size = 'sm' | 'lg'

export function RichText({ text, size = 'sm' }: { text: string; size?: Size }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  const big = size === 'lg'

  /** 條列：`-`／`*`／`•` 走無序，`1.` 走有序。 */
  let bullets: string[] = []
  let ordered = false
  /**
   * 有序清單從幾號開始。
   *
   * 模型常寫「1. 第一點」後面接幾個 `-` 子項，再寫「2. 第二點」。子項會把前一
   * 個 `<ol>` 收掉，於是下一個 `<ol>` 又從 1 開始——畫面上就是 1、1、1。問它
   * 「用三點講」然後看到三個第一點，看起來像它壞了。
   *
   * 記住它寫的號碼，開新清單時用 `start` 接回去。
   */
  let startAt = 1
  /** 上一塊是不是已經是間隔了。見下面空行那一段。 */
  let gapped = false

  const flush = () => {
    if (bullets.length === 0) return
    const List = ordered ? 'ol' : 'ul'
    blocks.push(
      <List
        key={`list-${blocks.length}`}
        {...(ordered && startAt !== 1 ? { start: startAt } : {})}
        className={cn('flex flex-col pl-5', big ? 'my-2 gap-1.5' : 'my-1 gap-0.5')}
      >
        {bullets.map((item, index) => (
          <li key={index} className={cn(ordered ? 'list-decimal' : 'list-disc', 'text-ink-200')}>
            {inline(item)}
          </li>
        ))}
      </List>
    )
    bullets = []
    ordered = false
  }

  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd()

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      // 從有序換成無序就先把前一串收掉，不然兩種會混在同一個清單裡。
      if (ordered) flush()
      bullets.push(bullet[1] ?? '')
      continue
    }

    /*
     * `1. 這樣的` 也是條列。
     *
     * 本來沒認，於是模型回的編號清單會變成一堆「1.」開頭的獨立段落——讀起來
     * 像是它每一句都重新開始數。模型寫編號清單的頻率比寫 `-` 高。
     */
    const numbered = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      if (!ordered) {
        flush()
        // 接著模型寫的號碼，而不是每次都從 1 重來。
        startAt = Number(numbered[1]) || 1
      }
      ordered = true
      bullets.push(numbered[2] ?? '')
      continue
    }

    flush()

    if (!line.trim()) {
      /*
       * 一個空行是段落分隔，連著好幾個還是一個。
       *
       * 這段註解本來就在，而程式碼沒有照做——每一個空行都推一塊間隔，所以模型
       * 回的那種「段落之間空兩三行」會變成越來越大的空白。`gapped` 讓它真的
       * 只算一次（Z198）。
       */
      if (blocks.length > 0 && !gapped) {
        blocks.push(<div key={`gap-${index}`} className="h-2" />)
        gapped = true
      }
      continue
    }
    gapped = false

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p
          key={index}
          className={cn('font-semibold text-ink-50', big ? 'mt-2 text-base' : 'mt-1 text-[13px]')}
        >
          {inline(heading[2] ?? '')}
        </p>
      )
      continue
    }

    blocks.push(
      <p key={index} className="text-ink-200">
        {inline(line)}
      </p>
    )
  }

  flush()

  return (
    <div
      className={cn('flex flex-col', big ? 'text-[15px] leading-7' : 'text-[13px] leading-relaxed')}
    >
      {blocks}
    </div>
  )
}

/**
 * `**粗體**` and `` `程式碼` ``, and nothing else.
 *
 * One pass, alternating between the two markers, so `**a `b` c**` degrades to
 * plain text rather than to broken nesting.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g

  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))

    if (match[1] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold text-ink-50">
          {match[1]}
        </strong>
      )
    } else if (match[2] !== undefined) {
      out.push(
        <code
          key={key++}
          className="rounded bg-stage-900 px-1 py-0.5 font-mono text-[11px] text-accent-300"
        >
          {match[2]}
        </code>
      )
    }

    last = match.index + match[0].length
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}
