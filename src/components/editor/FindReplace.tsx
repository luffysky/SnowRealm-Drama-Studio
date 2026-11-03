'use client'

import type { Editor } from '@tiptap/react'
import { ArrowDown, ArrowUp, Replace, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * 尋找與取代.
 *
 * The feature a long manuscript cannot do without: when a character is
 * renamed in chapter 40, every earlier mention has to change, and doing that
 * by eye across 120 episodes is how continuity errors get published.
 *
 * Done through ProseMirror positions and transactions, **not** by regexing
 * `editor.getHTML()`. The regex approach is the obvious one and it is wrong:
 * it matches inside tag names and attributes, it destroys marks that span the
 * match, and replacing the whole document collapses the undo history into a
 * single unrevertable step. Here each replacement is a real document edit, so
 * undo works one match at a time and bold stays bold.
 */

type Match = { from: number; to: number }

export function FindReplace({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [needle, setNeedle] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [index, setIndex] = useState(0)
  /** Bumped after each edit so the match list is recomputed. */
  const [revision, setRevision] = useState(0)

  const matches = useMemo(
    () => findMatches(editor, needle, caseSensitive),
    // `revision` is the dependency that matters: the document changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, needle, caseSensitive, revision]
  )

  const current = matches.length > 0 ? Math.min(index, matches.length - 1) : 0

  // Keep the selected match on screen as the user steps through.
  useEffect(() => {
    const match = matches[current]
    if (!match) return
    editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
  }, [editor, matches, current])

  function step(delta: number) {
    if (matches.length === 0) return
    setIndex((value) => (value + delta + matches.length) % matches.length)
  }

  function replaceCurrent() {
    const match = matches[current]
    if (!match) return

    editor
      .chain()
      .focus()
      .insertContentAt({ from: match.from, to: match.to }, replacement)
      .run()

    setRevision((n) => n + 1)
  }

  function replaceAll() {
    if (matches.length === 0) return

    /*
     * Back to front. Replacing from the start shifts every later position by
     * the length difference, so a forward loop quietly corrupts the document
     * whenever the replacement is not exactly as long as the match.
     */
    const chain = editor.chain().focus()
    for (const match of [...matches].reverse()) {
      chain.insertContentAt({ from: match.from, to: match.to }, replacement)
    }
    chain.run()

    setRevision((n) => n + 1)
    setIndex(0)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-stage-700/60 bg-stage-850/60 px-2 py-1.5">
      <label className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-ink-600"
        />
        <input
          autoFocus
          value={needle}
          onChange={(event) => {
            setNeedle(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              step(event.shiftKey ? -1 : 1)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder="尋找"
          aria-label="尋找"
          className="h-7 w-36 rounded-md bg-stage-900 pr-2 pl-7 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
      </label>

      <span className="min-w-14 text-center text-[10px] text-ink-600 tabular-nums">
        {needle ? `${matches.length > 0 ? current + 1 : 0} / ${matches.length}` : '—'}
      </span>

      <IconButton label="上一個" onClick={() => step(-1)} disabled={matches.length === 0}>
        <ArrowUp aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton label="下一個" onClick={() => step(1)} disabled={matches.length === 0}>
        <ArrowDown aria-hidden className="size-3.5" />
      </IconButton>

      <span aria-hidden className="mx-0.5 h-4 w-px bg-stage-700" />

      <input
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
        placeholder="取代為"
        aria-label="取代為"
        className="h-7 w-36 rounded-md bg-stage-900 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
      />

      <button
        type="button"
        onClick={replaceCurrent}
        disabled={matches.length === 0}
        className="h-7 rounded-md px-2 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
      >
        取代
      </button>
      <button
        type="button"
        onClick={replaceAll}
        disabled={matches.length === 0}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
      >
        <Replace aria-hidden className="size-3" />
        全部取代
      </button>

      <button
        type="button"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((value) => !value)}
        title="區分大小寫"
        className={cn(
          'h-7 rounded-md px-2 text-[11px] transition-colors',
          caseSensitive
            ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
            : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200'
        )}
      >
        Aa
      </button>

      <IconButton label="關閉" onClick={onClose}>
        <X aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="ml-auto-none rounded-md p-1.5 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/**
 * Every occurrence, as document positions.
 *
 * Walks text nodes and converts offsets within each into absolute positions.
 * A match cannot span two text nodes here — that is the price of not
 * reimplementing ProseMirror's text mapping, and it only bites when a phrase
 * is split by a mark boundary mid-word, which in prose is rare.
 */
function findMatches(editor: Editor, needle: string, caseSensitive: boolean): Match[] {
  if (!needle) return []

  const matches: Match[] = []
  const target = caseSensitive ? needle : needle.toLowerCase()

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return

    const haystack = caseSensitive ? node.text : node.text.toLowerCase()

    let at = haystack.indexOf(target)
    while (at !== -1) {
      matches.push({ from: pos + at, to: pos + at + needle.length })
      at = haystack.indexOf(target, at + Math.max(1, needle.length))
    }
  })

  return matches
}
