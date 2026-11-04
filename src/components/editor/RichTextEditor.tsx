'use client'

import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  ListTree,
  Minus,
  Quote,
  Redo2,
  Search,
  SlidersHorizontal,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AiSelectionMenu, type AiSelectionAction } from '@/components/editor/AiSelectionMenu'
import { buildExtensions } from '@/components/editor/extensions'
import { FindReplace } from '@/components/editor/FindReplace'
import { OutlinePanel } from '@/components/editor/OutlinePanel'
import {
  SCRIPT_BLOCK_LABEL,
  SCRIPT_BLOCK_SHORTCUT,
  SCRIPT_BLOCKS,
} from '@/components/editor/screenplay'
import {
  EDITOR_SURFACE_LABEL,
  modulesFor,
  type EditorModuleId,
  type EditorSurface,
} from '@/lib/editor/modules'
import { cn } from '@/lib/utils'

/**
 * The shared rich-text editor for 小說 and 劇本.
 *
 * Which buttons exist is decided by the enabled module set, not by this
 * component: a disabled module contributes neither an extension nor a toolbar
 * item, so there is no shortcut for a feature the pair switched off.
 *
 * Content is HTML. The previous plain-text drafts still load — TipTap treats a
 * bare string as a paragraph — so nothing written before this change is lost.
 */

export type RichTextEditorProps = {
  surface: EditorSurface
  enabledModules: EditorModuleId[]
  initialContent: string
  placeholder?: string
  /** Called on every change, with the document as HTML. */
  onChange: (html: string) => void
  /** Rendered beside the toolbar's module button. */
  toolbarExtra?: ReactNode
  onToggleModule?: (id: EditorModuleId, next: boolean) => void
  /**
   * Called when an AI action is picked from the selection menu.
   *
   * The menu never edits the document: it hands the passage up so the AI panel
   * can run the usual estimate → run → diff → adopt. See `AiSelectionMenu`.
   */
  onAiAction?: (action: AiSelectionAction, selectedText: string) => void
  /**
   * Hands the live editor out, so a panel beside it can insert at the cursor.
   *
   * Called with null on teardown. Insertion has to go through the editor
   * instance rather than through the HTML string — rebuilding the document
   * from a string loses the cursor, the selection and the undo history, and
   * undo is exactly what somebody wants right after an AI paragraph lands in
   * the wrong place.
   */
  onReady?: (editor: Editor | null) => void
}

export function RichTextEditor({
  surface,
  enabledModules,
  initialContent,
  placeholder = '在這裡寫。',
  onChange,
  toolbarExtra,
  onToggleModule,
  onAiAction,
  onReady,
}: RichTextEditorProps) {
  const [findOpen, setFindOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(true)
  const enabled = useMemo(() => new Set(enabledModules), [enabledModules])

  const extensions = useMemo(
    () => buildExtensions({ enabled, placeholder }),
    [enabled, placeholder]
  )


  const editor = useEditor({
    extensions,
    content: initialContent,
    // Next renders this on the server first; TipTap must not try to match it.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose-editor min-h-[22rem] px-5 py-4 text-sm leading-[2] text-ink-100 focus:outline-none',
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  })

  /*
   * Publish the instance after mount.
   *
   * `onReady` is in the dependency list rather than hidden behind a ref, so
   * callers have to pass a stable callback — which is the honest contract.
   * A ref updated during render reads as a way round the rule rather than an
   * answer to it.
   */
  useEffect(() => {
    onReady?.(editor ?? null)
    return () => onReady?.(null)
  }, [editor, onReady])

  if (!editor) {
    return (
      <div className="min-h-[24rem] animate-pulse px-5 py-4 text-sm text-ink-700">
        編輯器載入中…
      </div>
    )
  }

  const showToc = enabled.has('outline') && tocOpen
  const showFind = enabled.has('findReplace') && findOpen

  return (
    /* `editor-shell` is the positioning context the selection menu measures
       against; it must not be removed. */
    <div
      className="editor-shell relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (!enabled.has('findReplace')) return
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          setFindOpen(true)
        }
      }}
    >
      <Toolbar
        editor={editor}
        enabled={enabled}
        surface={surface}
        onToggleModule={onToggleModule}
        extra={toolbarExtra}
        findOpen={findOpen}
        onToggleFind={() => setFindOpen((value) => !value)}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen((value) => !value)}
      />

      {showFind && <FindReplace editor={editor} onClose={() => setFindOpen(false)} />}

      <div className="flex min-h-0 flex-1">
        {showToc && <OutlinePanel editor={editor} />}
        <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto" />
      </div>

      {enabled.has('aiSelection') && onAiAction && (
        <AiSelectionMenu editor={editor} surface={surface} onAction={onAiAction} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  editor,
  enabled,
  surface,
  onToggleModule,
  extra,
  findOpen,
  onToggleFind,
  tocOpen,
  onToggleToc,
}: {
  editor: Editor
  enabled: ReadonlySet<EditorModuleId>
  surface: EditorSurface
  onToggleModule?: (id: EditorModuleId, next: boolean) => void
  extra?: ReactNode
  findOpen: boolean
  onToggleFind: () => void
  tocOpen: boolean
  onToggleToc: () => void
}) {
  // Re-render on selection changes so the active states are honest.
  const [, force] = useState(0)
  useEffect(() => {
    const update = () => force((n) => n + 1)
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-stage-700/60 px-2 py-1.5">
      <Button
        label="復原"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        label="重做"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="size-3.5" />
      </Button>

      {enabled.has('marks') && (
        <>
          <Divider />
          <Button
            label="粗體"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-3.5" />
          </Button>
          <Button
            label="斜體"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-3.5" />
          </Button>
          <Button
            label="底線"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="size-3.5" />
          </Button>
          <Button
            label="刪除線"
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="size-3.5" />
          </Button>
          <Button
            label="螢光標記"
            active={editor.isActive('highlight')}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          >
            <Highlighter className="size-3.5" />
          </Button>
        </>
      )}

      {enabled.has('headings') && (
        <>
          <Divider />
          {([1, 2, 3] as const).map((level) => (
            <Button
              key={level}
              label={`標題 ${level}`}
              active={editor.isActive('heading', { level })}
              onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
            >
              {level === 1 ? (
                <Heading1 className="size-3.5" />
              ) : level === 2 ? (
                <Heading2 className="size-3.5" />
              ) : (
                <Heading3 className="size-3.5" />
              )}
            </Button>
          ))}
        </>
      )}

      {enabled.has('lists') && (
        <>
          <Divider />
          <Button
            label="項目符號"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-3.5" />
          </Button>
          <Button
            label="編號清單"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-3.5" />
          </Button>
          <Button
            label="待辦清單"
            active={editor.isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListTodo className="size-3.5" />
          </Button>
        </>
      )}

      {enabled.has('quote') && (
        <>
          <Divider />
          <Button
            label="引言"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="size-3.5" />
          </Button>
          <Button
            label="分隔線"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="size-3.5" />
          </Button>
        </>
      )}

      {enabled.has('align') && (
        <>
          <Divider />
          {(
            [
              ['left', AlignLeft, '置左'],
              ['center', AlignCenter, '置中'],
              ['right', AlignRight, '置右'],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              label={label}
              active={editor.isActive({ textAlign: value })}
              onClick={() => editor.chain().focus().setTextAlign(value).run()}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}
        </>
      )}

      {enabled.has('screenplay') && (
        <>
          <Divider />
          {SCRIPT_BLOCKS.map((block) => (
            <button
              key={block}
              type="button"
              title={`${SCRIPT_BLOCK_LABEL[block]}\uff08${SCRIPT_BLOCK_SHORTCUT[block]}\uff09`}
              aria-pressed={editor.isActive('paragraph', { scriptBlock: block })}
              onClick={() => editor.chain().focus().toggleScriptBlock(block).run()}
              className={cn(
                'rounded-md px-1.5 py-1 text-[10px] whitespace-nowrap transition-colors',
                editor.isActive('paragraph', { scriptBlock: block })
                  ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                  : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
              )}
            >
              {SCRIPT_BLOCK_LABEL[block]}
            </button>
          ))}
        </>
      )}

      {enabled.has('link') && (
        <>
          <Divider />
          <Button
            label="連結"
            active={editor.isActive('link')}
            onClick={() => {
              if (editor.isActive('link')) {
                editor.chain().focus().unsetLink().run()
                return
              }
              const url = window.prompt('連結網址')
              if (url) editor.chain().focus().setLink({ href: url }).run()
            }}
          >
            <Link2 className="size-3.5" />
          </Button>
        </>
      )}

      {enabled.has('table') && (
        <>
          <Divider />
          <Button
            label="插入表格"
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            <TableIcon className="size-3.5" />
          </Button>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        {enabled.has('outline') && (
          <Button
            label="章節目錄"
            active={tocOpen}
            onClick={onToggleToc}
            // Hidden on narrow screens because the panel itself is: a toggle
            // for something that cannot appear is worse than no toggle.
            className="hidden xl:inline-flex"
          >
            <ListTree className="size-3.5" />
          </Button>
        )}

        {enabled.has('findReplace') && (
          <Button label="尋找與取代（Ctrl+F）" active={findOpen} onClick={onToggleFind}>
            <Search className="size-3.5" />
          </Button>
        )}

        {extra}
        {onToggleModule && (
          <ModuleMenu surface={surface} enabled={enabled} onToggle={onToggleModule} />
        )}
      </div>
    </div>
  )
}

/** Turns editor modules on and off, for this installation. */
function ModuleMenu({
  surface,
  enabled,
  onToggle,
}: {
  surface: EditorSurface
  enabled: ReadonlySet<EditorModuleId>
  onToggle: (id: EditorModuleId, next: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const modules = modulesFor(surface)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="編輯器模組"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
      >
        <SlidersHorizontal aria-hidden className="size-3.5" />
        模組
      </button>

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="panel absolute right-0 z-20 mt-1 w-72 animate-rise overflow-hidden rounded-xl bg-stage-850 p-1 shadow-2xl shadow-stage-990/80 ring-1 ring-stage-700"
          >
            <p className="px-3 py-2 text-[10px] text-ink-600">
              {EDITOR_SURFACE_LABEL[surface]}・設定會套用到兩位成員
            </p>

            <ul className="max-h-80 overflow-y-auto">
              {modules.map((module) => {
                const on = enabled.has(module.id)
                return (
                  <li key={module.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 transition-colors',
                        module.locked ? 'cursor-default opacity-60' : 'hover:bg-stage-800'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={module.locked}
                        onChange={(event) => onToggle(module.id, event.target.checked)}
                        className="mt-0.5 size-3.5 shrink-0 accent-accent-500"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[11px] font-medium text-ink-100">
                          {module.label}
                          {module.locked && (
                            <span className="ml-1 text-[9px] text-ink-600">必要</span>
                          )}
                        </span>
                        <span className="text-[10px] leading-relaxed text-ink-500">
                          {module.description}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function Button({
  label,
  active,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-md transition-colors',
        className,
        disabled
          ? 'cursor-default text-ink-700'
          : active
            ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
            : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-stage-700" />
}
