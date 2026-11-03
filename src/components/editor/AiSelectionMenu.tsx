'use client'

import type { Editor } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * The AI actions that float over a selection.
 *
 * Both reference projects put the model's reply straight into the document and
 * offer an undo button for five seconds. That is the wrong trade for a
 * manuscript: the writer has to read the replacement *after* it has already
 * replaced what they wrote, and the thing they are comparing against is gone.
 *
 * So this menu does not edit anything. It hands the selected text to the AI
 * panel, which keeps the contract every other AI surface here follows —
 * estimate, run, diff against the current text, then adopt. The menu's job is
 * only to say *which* passage and *which* task, without making the writer
 * paste a paragraph into a side panel by hand.
 */

export type AiSelectionAction =
  | 'NOVEL_POLISH'
  | 'NOVEL_REWRITE'
  | 'NOVEL_REVIEW'
  | 'SCRIPT_ANALYZE'

type Action = { kind: AiSelectionAction; label: string; title: string }

/**
 * Which actions a surface offers.
 *
 * 潤稿 and 改寫 are the same operation on prose and on dialogue, so both
 * surfaces get them. The third differs: a novel wants 審稿 (pacing, motive,
 * canon), a script wants 片長分析 — asking a screenplay for prose notes is
 * the wrong question, and the one thing a short drama is always fighting is
 * the clock.
 */
const ACTIONS: Record<'NOVEL' | 'SCRIPT', Action[]> = {
  NOVEL: [
    { kind: 'NOVEL_POLISH', label: '潤稿', title: '修語病、統一用詞、加強畫面感，不動劇情' },
    { kind: 'NOVEL_REWRITE', label: '改寫', title: '保留事件，換一種寫法' },
    { kind: 'NOVEL_REVIEW', label: '審稿', title: '逐條指出問題，只報告不改寫' },
  ],
  SCRIPT: [
    { kind: 'NOVEL_POLISH', label: '潤稿', title: '修對白語病、統一用詞，不動劇情' },
    { kind: 'NOVEL_REWRITE', label: '改寫', title: '保留事件，換一種寫法' },
    { kind: 'SCRIPT_ANALYZE', label: '片長分析', title: '估算這段的片長，指出過長的對白' },
  ],
}

/** Below this a "selection" is usually a mis-drag, not a passage. */
const MIN_CHARS = 8

export function AiSelectionMenu({
  editor,
  surface,
  onAction,
}: {
  editor: Editor
  surface: 'NOVEL' | 'SCRIPT'
  onAction: (action: AiSelectionAction, text: string) => void
}) {
  const [box, setBox] = useState<{ top: number; left: number; text: string } | null>(null)

  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection

      if (empty) {
        setBox(null)
        return
      }

      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      if (text.length < MIN_CHARS) {
        setBox(null)
        return
      }

      /*
       * Positioned from the selection's own client rectangle rather than with
       * a popup library: one floating element over a textarea does not justify
       * a positioning engine, and `coordsAtPos` is exactly what it is for.
       */
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      const parent = editor.view.dom.closest('.editor-shell') as HTMLElement | null
      if (!parent) return

      const bounds = parent.getBoundingClientRect()

      setBox({
        top: Math.min(start.top, end.top) - bounds.top - 44,
        left: (start.left + end.left) / 2 - bounds.left,
        text,
      })
    }

    editor.on('selectionUpdate', update)
    // A scroll moves the selection under the menu; hide rather than lie.
    const hide = () => setBox(null)
    editor.view.dom.addEventListener('scroll', hide)

    return () => {
      editor.off('selectionUpdate', update)
      editor.view.dom.removeEventListener('scroll', hide)
    }
  }, [editor])

  if (!box) return null

  return (
    <div
      role="toolbar"
      aria-label="AI 動作"
      style={{ top: Math.max(4, box.top), left: box.left }}
      className="panel absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-stage-850 p-1 shadow-xl shadow-stage-990/60 ring-1 ring-stage-700"
    >
      <span className="flex items-center gap-1 px-1.5 text-[10px] text-ink-600">
        <Sparkles aria-hidden className="size-3 text-accent-400" />
        {box.text.length} 字
      </span>

      {ACTIONS[surface].map((action) => (
        <button
          key={action.kind}
          type="button"
          title={action.title}
          onClick={() => {
            onAction(action.kind, box.text)
            setBox(null)
          }}
          className="rounded-md px-2 py-1 text-[11px] text-ink-300 transition-colors hover:bg-stage-800 hover:text-ink-50"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
