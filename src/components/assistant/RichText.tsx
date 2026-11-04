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

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')

  let bullets: string[] = []

  const flush = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1 flex flex-col gap-0.5 pl-4">
        {bullets.map((item, index) => (
          <li key={index} className="list-disc text-ink-200">
            {inline(item)}
          </li>
        ))}
      </ul>
    )
    bullets = []
  }

  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd()

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      bullets.push(bullet[1] ?? '')
      continue
    }

    flush()

    if (!line.trim()) {
      // One blank line is a paragraph break; a run of them is still one.
      if (blocks.length > 0) blocks.push(<div key={`gap-${index}`} className="h-2" />)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={index} className="mt-1 text-[13px] font-semibold text-ink-50">
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

  return <div className="flex flex-col text-[13px] leading-relaxed">{blocks}</div>
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
