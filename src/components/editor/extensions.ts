'use client'

import CharacterCount from '@tiptap/extension-character-count'
import Focus from '@tiptap/extension-focus'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { Table } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import type { Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { EditorModuleId } from '@/lib/editor/modules'

/**
 * Turns a set of enabled module ids into TipTap extensions.
 *
 * Everything optional is switched off in StarterKit and re-added by its module,
 * so a disabled module genuinely is not loaded rather than merely hidden from
 * the toolbar — a keyboard shortcut for a feature the pair turned off would be
 * worse than no switch at all.
 */
export function buildExtensions(input: {
  enabled: ReadonlySet<EditorModuleId>
  placeholder: string
}): Extensions {
  const { enabled, placeholder } = input

  const extensions: Extensions = [
    StarterKit.configure({
      heading: enabled.has('headings') ? { levels: [1, 2, 3] } : false,
      bulletList: enabled.has('lists') ? {} : false,
      orderedList: enabled.has('lists') ? {} : false,
      listItem: enabled.has('lists') ? {} : false,
      blockquote: enabled.has('quote') ? {} : false,
      horizontalRule: enabled.has('quote') ? {} : false,
      bold: enabled.has('marks') ? {} : false,
      italic: enabled.has('marks') ? {} : false,
      strike: enabled.has('marks') ? {} : false,
      // Prose, not source: a code block in a novel is a mistake, not a feature.
      code: false,
      codeBlock: false,
      link: false,
      underline: false,
    }),
    Placeholder.configure({ placeholder }),
    // Counts what the reader sees; the server recomputes from the text anyway.
    CharacterCount.configure({ limit: null }),
  ]

  if (enabled.has('marks')) {
    extensions.push(Underline, Highlight.configure({ multicolor: false }))
  }

  if (enabled.has('link')) {
    extensions.push(
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https'],
        HTMLAttributes: { class: 'text-accent-300 underline underline-offset-2' },
      })
    )
  }

  if (enabled.has('image')) {
    extensions.push(
      Image.configure({
        inline: false,
        // Served through /api/files, which checks the session — never a public
        // bucket URL, which would outlive the reader's access.
        HTMLAttributes: { class: 'my-4 max-w-full rounded-lg' },
      })
    )
  }

  if (enabled.has('lists')) {
    extensions.push(TaskList, TaskItem.configure({ nested: true }))
  }

  if (enabled.has('table')) {
    extensions.push(Table.configure({ resizable: true }), TableRow, TableHeader, TableCell)
  }

  if (enabled.has('align')) {
    extensions.push(TextAlign.configure({ types: ['heading', 'paragraph'] }))
  }

  if (enabled.has('typography')) {
    extensions.push(Typography)
  }

  if (enabled.has('focus')) {
    extensions.push(Focus.configure({ className: 'has-focus', mode: 'shallowest' }))
  }

  return extensions
}

/**
 * Characters as a human counts them: no markup, no whitespace.
 *
 * The browser does this with the DOM rather than a regular expression, because
 * stripping tags with a pattern is how `<p>a</p><p>b</p>` silently becomes
 * "ab" — or worse, how an attribute value gets counted as prose.
 */
export function countHtmlChars(html: string): number {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '').replace(/\s/g, '').length

  const holder = document.createElement('div')
  holder.innerHTML = html
  return (holder.textContent ?? '').replace(/\s/g, '').length
}
