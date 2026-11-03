'use client'

import type { Editor } from '@tiptap/react'

/**
 * Derived structure and statistics.
 *
 * Both are computed from the document rather than stored. A stored table of
 * contents is a second copy of the headings, and a second copy is a thing that
 * can disagree with the first — which it will, the moment someone edits a
 * heading and the sync misses.
 *
 * Pure functions rather than a TipTap extension: nothing here needs to
 * participate in the schema or the transaction pipeline, and a plain function
 * can be called from a render without a plugin round trip.
 */

export type TocEntry = {
  /** Document position, for scrolling and for setting the selection. */
  pos: number
  level: number
  text: string
}

export function computeToc(editor: Editor): TocEntry[] {
  const entries: TocEntry[] = []

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    entries.push({
      pos,
      level: Number(node.attrs.level ?? 1),
      text: node.textContent.trim() || '（無標題）',
    })
  })

  return entries
}

export type EditorStats = {
  /** Characters as a reader counts them: no markup, no whitespace. */
  chars: number
  /** Paragraphs with text in them. */
  paragraphs: number
  /**
   * Estimated reading time in minutes.
   *
   * 350 CJK characters a minute. The usual 200-words-a-minute figure is for
   * English and would report this corpus as several times longer than it is.
   */
  readingMinutes: number
}

export function computeStats(editor: Editor): EditorStats {
  const text = editor.state.doc.textContent
  const chars = text.replace(/\s/g, '').length

  let paragraphs = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paragraph' && node.textContent.trim()) paragraphs += 1
  })

  return {
    chars,
    paragraphs,
    readingMinutes: Math.max(1, Math.round(chars / 350)),
  }
}
