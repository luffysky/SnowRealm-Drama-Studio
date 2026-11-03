'use client'

import type { Editor } from '@tiptap/react'
import { ListTree } from 'lucide-react'
import { useEffect, useState } from 'react'
import { computeStats, computeToc, type TocEntry } from '@/components/editor/toc'
import { cn } from '@/lib/utils'

/**
 * 章節目錄 — the headings of the chapter in front of you, as a jump list.
 *
 * Derived from the document on every change rather than stored. A stored
 * outline is a second copy of the headings, and a second copy is something
 * that can disagree with the first — which it will, the first time someone
 * renames a heading and the sync misses.
 *
 * Earns its place once a chapter is long enough that scrolling to find a scene
 * costs more than reading this list. Below that it is noise, which is why it
 * is a module the pair can switch off.
 */
export function OutlinePanel({ editor }: { editor: Editor }) {
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [stats, setStats] = useState({ chars: 0, paragraphs: 0, readingMinutes: 1 })
  const [activePos, setActivePos] = useState<number | null>(null)

  useEffect(() => {
    const recompute = () => {
      setEntries(computeToc(editor))
      setStats(computeStats(editor))
    }

    const trackSelection = () => {
      // Which heading the caret currently sits under: the last one at or
      // before it.
      const at = editor.state.selection.from
      const headings = computeToc(editor)
      const containing = [...headings].reverse().find((entry) => entry.pos <= at)
      setActivePos(containing?.pos ?? null)
    }

    recompute()
    trackSelection()

    editor.on('update', recompute)
    editor.on('selectionUpdate', trackSelection)
    return () => {
      editor.off('update', recompute)
      editor.off('selectionUpdate', trackSelection)
    }
  }, [editor])

  function jump(entry: TocEntry) {
    editor
      .chain()
      .focus()
      // +1 lands inside the heading rather than before it, so the caret is
      // where the writer expects to start typing.
      .setTextSelection(entry.pos + 1)
      .scrollIntoView()
      .run()
  }

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-stage-700/60 bg-stage-900/40 xl:flex">
      <div className="flex items-center gap-1.5 border-b border-stage-700/60 px-3 py-2">
        <ListTree aria-hidden className="size-3.5 text-accent-400" />
        <span className="text-[11px] font-medium text-ink-300">章節目錄</span>
      </div>

      <nav aria-label="章節目錄" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-[10px] leading-relaxed text-ink-700">
            還沒有標題。用標題層級分段之後，這裡會列出來，點一下就跳過去。
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {entries.map((entry) => (
              <li key={entry.pos}>
                <button
                  type="button"
                  onClick={() => jump(entry)}
                  className={cn(
                    'w-full truncate rounded-md py-1 pr-1.5 text-left text-[11px] transition-colors',
                    entry.level === 1 ? 'pl-2' : entry.level === 2 ? 'pl-4' : 'pl-6',
                    entry.pos === activePos
                      ? 'bg-accent-600/20 text-ink-50'
                      : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200'
                  )}
                  title={entry.text}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <dl className="flex flex-col gap-0.5 border-t border-stage-700/60 px-3 py-2 text-[10px] text-ink-600">
        <div className="flex justify-between gap-2">
          <dt>字數</dt>
          <dd className="text-ink-400 tabular-nums">{stats.chars.toLocaleString('en-US')}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>段落</dt>
          <dd className="text-ink-400 tabular-nums">{stats.paragraphs}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt title="以每分鐘 350 字估算">閱讀時間</dt>
          <dd className="text-ink-400 tabular-nums">約 {stats.readingMinutes} 分</dd>
        </div>
      </dl>
    </aside>
  )
}
