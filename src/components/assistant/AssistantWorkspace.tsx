'use client'

import {
  Check,
  Copy,
  HelpCircle,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandHelp } from '@/components/assistant/CommandHelp'
import { RichText } from '@/components/assistant/RichText'
import { ProposalCard } from '@/components/chat/ProposalCard'
import type { ChannelMessage } from '@/components/chat/useChatChannel'
import { useBottomDock } from '@/components/studio/useBottomDock'
import { useToast } from '@/components/ui/Toast'
import { matchingCommands } from '@/lib/assistant/triggers'
import { formatClock } from '@/lib/chat-view'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * AI 助理 (Z100).
 *
 * Its own page, its own threads. The assistant used to be summoned into the
 * two-person conversation with `@助理`, which put a question to a model in the
 * middle of two people talking to each other — same scrollback, same search,
 * same unread badge — and made its context their context.
 *
 * Nothing here is a chat bubble. A reply from the assistant is often a few
 * hundred words with a diff attached, and a 70%-width bubble is the wrong
 * shape for reading it.
 */

export type ThreadRow = {
  id: string
  title: string
  preview: string
  messageCount: number
  updatedAt: string
}

type Props = {
  meId: string
  myName: string
  myColor: string
  initialThreads: ThreadRow[]
  initialThreadId: string
  initialMessages: ChannelMessage[]
}

const PAGE = 40

/** What the server calls a thread nobody has named. */
const UNTITLED = '新對話'

export function AssistantWorkspace({
  meId,
  myName,
  myColor,
  initialThreads,
  initialThreadId,
  initialMessages,
}: Props) {
  const toast = useToast()

  const [threads, setThreads] = useState(initialThreads)
  const [threadId, setThreadId] = useState(initialThreadId)
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  /** What each turn cost, by reply id. Not stored; this session only. */
  const [costs, setCosts] = useState<Record<string, number>>({})

  /* Keeps the floating chat ball off the send button. */
  const dockRef = useBottomDock<HTMLDivElement>()

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  const active = threads.find((thread) => thread.id === threadId)

  /* -------------------------------------------------------------- scrolling */

  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, thinking])

  /* ----------------------------------------------------------------- threads */

  const openThread = useCallback(
    async (id: string) => {
      if (id === threadId) {
        setListOpen(false)
        return
      }

      setLoading(true)
      setListOpen(false)
      try {
        const response = await apiFetch(`/api/assistant/threads/${id}/messages?limit=${PAGE}`)
        if (!response.ok) throw new Error(await readApiError(response))
        const body = (await response.json()) as { messages: ChannelMessage[] }

        setThreadId(id)
        setMessages(body.messages)
        stick.current = true
        /*
         * replaceState rather than a router navigation: switching thread is a
         * client-side swap of one list, and a server round trip would re-render
         * the whole shell to change which thread is highlighted.
         */
        window.history.replaceState(null, '', `/assistant?t=${id}`)
      } catch (cause) {
        toast.error('打不開那條對話串', cause instanceof Error ? cause.message : undefined)
      } finally {
        setLoading(false)
      }
    },
    [threadId, toast]
  )

  async function newThread() {
    try {
      const response = await apiFetch('/api/assistant/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as { thread: ThreadRow }

      setThreads((rows) => [body.thread, ...rows])
      setThreadId(body.thread.id)
      setMessages([])
      setListOpen(false)
      stick.current = true
      window.history.replaceState(null, '', `/assistant?t=${body.thread.id}`)
    } catch (cause) {
      toast.error('開不了新對話', cause instanceof Error ? cause.message : undefined)
    }
  }

  async function rename(id: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed) return

    setThreads((rows) => rows.map((row) => (row.id === id ? { ...row, title: trimmed } : row)))
    try {
      const response = await apiFetch(`/api/assistant/threads/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
    } catch (cause) {
      toast.error('改名失敗', cause instanceof Error ? cause.message : undefined)
    }
  }

  async function remove(id: string) {
    try {
      const response = await apiFetch(`/api/assistant/threads/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response))

      const rest = threads.filter((row) => row.id !== id)
      setThreads(rest)

      if (id === threadId) {
        const next = rest[0]
        if (next) {
          await openThread(next.id)
        } else {
          await newThread()
        }
      }
      toast.success('已刪除')
    } catch (cause) {
      toast.error('刪不掉', cause instanceof Error ? cause.message : undefined)
    }
  }

  /* ------------------------------------------------------------------ history */

  async function loadMore() {
    const oldest = messages[0]
    if (!oldest || loadingMore) return

    setLoadingMore(true)
    try {
      const response = await apiFetch(
        `/api/assistant/threads/${threadId}/messages?before=${oldest.seq}&limit=${PAGE}`
      )
      if (!response.ok) return
      const body = (await response.json()) as { messages: ChannelMessage[] }
      if (body.messages.length === 0) return

      stick.current = false
      setMessages((rows) => [...body.messages, ...rows])
    } finally {
      setLoadingMore(false)
    }
  }

  /* ------------------------------------------------------------------ sending */

  async function submit() {
    const text = draft.trim()
    if (!text || sending || thinking) return

    setDraft('')
    setSending(true)
    stick.current = true

    let sentId: string
    try {
      const response = await apiFetch(`/api/assistant/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'TEXT', body: text }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { message: ChannelMessage; intent: string }
      setMessages((rows) => [...rows, body.message])
      sentId = body.message.id

      /*
       * The server names an untitled thread after its first message. Mirrored
       * here with the same rule rather than re-fetching the list, so the entry
       * in the sidebar stops saying 「新對話」 the moment you press send.
       */
      setThreads((rows) =>
        rows.map((row) => {
          if (row.id !== threadId || row.title !== UNTITLED) return row
          const title = text.replace(/^\/[a-zA-Z]+\s*/, '').trim().slice(0, 30)
          return title ? { ...row, title } : row
        })
      )
    } catch (cause) {
      setDraft(text)
      toast.error('送不出去', cause instanceof Error ? cause.message : undefined)
      return
    } finally {
      setSending(false)
    }

    /* ---- the turn itself -------------------------------------------------- */

    setThinking(true)
    try {
      const response = await apiFetch(`/api/assistant/threads/${threadId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: sentId }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const result = (await response.json()) as {
        messageId: string
        proposals: number
        costUsd: number
        spent: boolean
      }

      /*
       * Fetched rather than taken from the response: the reply carries its
       * proposals, the quoted message it answers, and a sequence number, all
       * of which the run route would otherwise have to re-assemble.
       */
      const since = await apiFetch(
        `/api/assistant/threads/${threadId}/messages?since=${messages[messages.length - 1]?.seq ?? 0}`
      )
      if (since.ok) {
        const body = (await since.json()) as { messages: ChannelMessage[] }
        setMessages((rows) => {
          const seen = new Set(rows.map((row) => row.id))
          return [...rows, ...body.messages.filter((row) => !seen.has(row.id))]
        })
      }

      if (result.costUsd > 0) {
        setCosts((map) => ({ ...map, [result.messageId]: result.costUsd }))
      }
    } catch (cause) {
      toast.error('助理沒有回應', cause instanceof Error ? cause.message : undefined)
    } finally {
      setThinking(false)
    }
  }

  const commands = matchingCommands(draft)
  const showPicker = draft.startsWith('/') && !draft.includes(' ') && commands.length > 0

  /* --------------------------------------------------------------------- view */

  return (
    <div className="flex h-[calc(100dvh-4rem)]">
      {/* ---- thread list ------------------------------------------------- */}
      <ThreadList
        threads={threads}
        activeId={threadId}
        open={listOpen}
        onClose={() => setListOpen(false)}
        onOpen={openThread}
        onNew={newThread}
        onRename={rename}
        onDelete={remove}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- header ---------------------------------------------------- */}
        <header className="flex shrink-0 items-center gap-2 border-b border-stage-700/60 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => setListOpen((on) => !on)}
            aria-label={listOpen ? '收起對話串列表' : '展開對話串列表'}
            className="tap rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 lg:hidden"
          >
            {listOpen ? (
              <PanelLeftClose aria-hidden className="size-4" />
            ) : (
              <PanelLeftOpen aria-hidden className="size-4" />
            )}
          </button>

          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-accent-600 text-white"
          >
            <Sparkles className="size-4" />
          </span>

          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-ink-50">
              {active?.title || 'AI 助理'}
            </span>
            <span className="text-[10px] text-ink-500">
              只讀這裡——「訊息」那邊的對話它看不到
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <CommandHelp onPick={(text) => setDraft(text)} />
          </div>

          <button
            type="button"
            onClick={() => void newThread()}
            className="tap inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-200 transition-colors hover:bg-stage-700"
          >
            <MessageSquarePlus aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">新對話</span>
          </button>
        </header>

        {/* ---- turns ----------------------------------------------------- */}
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
            if (el.scrollTop < 40) void loadMore()
          }}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {loadingMore && (
              <p className="flex items-center justify-center gap-1.5 text-[10px] text-ink-600">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                載入更早的
              </p>
            )}

            {loading ? (
              <p className="flex items-center justify-center gap-1.5 py-10 text-xs text-ink-500">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                載入中
              </p>
            ) : messages.length === 0 ? (
              <EmptyState onPick={(text) => setDraft(text)} />
            ) : (
              messages.map((message) => (
                <Turn
                  key={message.id}
                  message={message}
                  mine={message.senderId === meId}
                  myName={myName}
                  myColor={myColor}
                  costUsd={costs[message.id]}
                />
              ))
            )}

            {thinking && (
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-accent-600 text-white"
                >
                  <Sparkles className="size-3.5 animate-pulse" />
                </span>
                <p className="pt-1.5 text-[12px] text-cyan-300">正在想⋯</p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* ---- composer -------------------------------------------------- */}
        <div ref={dockRef} className="shrink-0 border-t border-stage-700/60 px-3 py-2.5 sm:px-4">
          <div className="mx-auto max-w-3xl">
            {showPicker && (
              <ul className="mb-2 flex flex-col gap-0.5 rounded-lg bg-stage-850 p-1 ring-1 ring-stage-700">
                {commands.map((command) => (
                  <li key={command.name}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(command.needsArgument ? `${command.label} ` : command.label)
                        document.getElementById('assistant-draft')?.focus()
                      }}
                      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-stage-800"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-accent-300">
                        {command.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-500">
                        {command.hint}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
              className="flex items-end gap-2"
            >
              <label className="sr-only" htmlFor="assistant-draft">
                跟助理說
              </label>
              <textarea
                id="assistant-draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter is a newline. A request to a model
                  // is usually one line, and a textarea that needs a mouse to
                  // submit is worse than one that occasionally eats a newline.
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submit()
                  }
                }}
                rows={1}
                placeholder={thinking ? '它還在想⋯' : '問它，或用 / 下指令'}
                disabled={thinking}
                className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-xl bg-stage-850 px-3 py-2 text-[13px] text-ink-100 ring-1 ring-stage-700 transition-colors placeholder:text-ink-600 focus:ring-accent-500/60 focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending || thinking}
                aria-label="送出"
                className="tap grid size-10 shrink-0 place-items-center rounded-xl bg-accent-600 text-white transition-colors hover:bg-accent-500 disabled:opacity-40"
              >
                {sending || thinking ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Send aria-hidden className="size-4" />
                )}
              </button>
            </form>

            <p className="mt-1.5 text-[10px] text-ink-600">
              它不會直接改東西。要改會給你 diff，你按套用才會動，而且先備份。
              指令說明在右上角的
              <HelpCircle aria-hidden className="mx-0.5 inline size-3 -translate-y-px" />
              。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Thread list                                                                 */
/* -------------------------------------------------------------------------- */

function ThreadList({
  threads,
  activeId,
  open,
  onClose,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: {
  threads: ThreadRow[]
  activeId: string
  open: boolean
  onClose: () => void
  onOpen: (id: string) => Promise<void>
  onNew: () => Promise<void>
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  return (
    <>
      {/* The phone backdrop. Off-canvas rather than stacked above the thread,
          because a list and a conversation both want the full height. */}
      {open && (
        <button
          type="button"
          aria-label="關閉列表"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-stage-990/70 lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-stage-700/60 bg-stage-900 transition-transform',
          'lg:static lg:z-auto lg:translate-x-0 lg:bg-transparent',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-stage-700/60 px-3 py-2.5">
          <span className="text-[11px] font-medium text-ink-300">對話串</span>
          <span className="text-[10px] text-ink-600 tabular-nums">{threads.length}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉列表"
            className="tap ml-auto rounded p-1 text-ink-500 hover:text-ink-200 lg:hidden"
          >
            <X aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void onNew()}
            aria-label="新對話"
            className="tap rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            <MessageSquarePlus aria-hidden className="size-4" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {threads.map((thread) => {
            const current = thread.id === activeId

            return (
              <li key={thread.id} className="group relative">
                {editing === thread.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void onRename(thread.id, title)
                      setEditing(null)
                    }}
                    className="p-1"
                  >
                    <input
                      autoFocus
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      onBlur={() => setEditing(null)}
                      maxLength={60}
                      aria-label="對話串名稱"
                      className="w-full rounded-md bg-stage-850 px-2 py-1.5 text-[12px] text-ink-100 ring-1 ring-accent-500/60 focus:outline-none"
                    />
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void onOpen(thread.id)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 pr-14 text-left transition-colors',
                        current ? 'bg-stage-800' : 'hover:bg-stage-850'
                      )}
                    >
                      <span
                        className={cn(
                          'w-full truncate text-[12px]',
                          current ? 'text-ink-50' : 'text-ink-200'
                        )}
                      >
                        {thread.title}
                      </span>
                      <span className="w-full truncate text-[10px] text-ink-600">
                        {thread.preview || '還沒說話'}
                      </span>
                    </button>

                    <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setTitle(thread.title)
                          setEditing(thread.id)
                        }}
                        aria-label={`重新命名 ${thread.title}`}
                        className="rounded p-1 text-ink-600 hover:bg-stage-700 hover:text-ink-200"
                      >
                        <Pencil aria-hidden className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(thread.id)}
                        aria-label={`刪除 ${thread.title}`}
                        className="rounded p-1 text-ink-600 hover:bg-rose-500/20 hover:text-rose-300"
                      >
                        <Trash2 aria-hidden className="size-3" />
                      </button>
                    </span>
                  </>
                )}

                {/* Two steps, in place. A native confirm() dialog blocks the
                    whole page and reads as a browser warning, not a choice. */}
                {confirming === thread.id && (
                  <div className="mx-1 mb-1 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1.5 ring-1 ring-rose-500/30">
                    <span className="min-w-0 flex-1 text-[10px] leading-tight text-rose-200">
                      刪掉這條對話串？已套用的修改不會跟著消失。
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null)
                        void onDelete(thread.id)
                      }}
                      className="shrink-0 rounded bg-rose-500 px-1.5 py-1 text-[10px] font-medium text-white"
                    >
                      刪
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="shrink-0 rounded px-1.5 py-1 text-[10px] text-ink-400 hover:text-ink-100"
                    >
                      不要
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </aside>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* One turn                                                                    */
/* -------------------------------------------------------------------------- */

function Turn({
  message,
  mine,
  myName,
  myColor,
  costUsd,
}: {
  message: ChannelMessage
  mine: boolean
  myName: string
  myColor: string
  costUsd: number | undefined
}) {
  const [copied, setCopied] = useState(false)

  if (message.recalledAt) {
    return <p className="text-center text-[10px] text-ink-700">訊息已收回</p>
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.body)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* A denied clipboard is not worth a toast. */
    }
  }

  return (
    <article className="flex items-start gap-2.5">
      {message.fromAssistant ? (
        <span
          aria-hidden
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-accent-600 text-white"
        >
          <Sparkles className="size-3.5" />
        </span>
      ) : (
        <span
          aria-hidden
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: mine ? myColor : '#6b7280' }}
        >
          {(mine ? myName : message.senderName).charAt(0)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium text-ink-300">
            {message.fromAssistant ? '助理' : mine ? myName : message.senderName}
          </span>
          <span className="text-[10px] text-ink-700 tabular-nums">
            {formatClock(new Date(message.createdAt))}
          </span>
          {message.editedAt && <span className="text-[10px] text-ink-700">已編輯</span>}
          {costUsd !== undefined && (
            <span className="text-[10px] text-ink-700 tabular-nums" title="這一輪的花費">
              ${costUsd.toFixed(4)}
            </span>
          )}

          <button
            type="button"
            onClick={() => void copy()}
            aria-label="複製這段"
            className="tap ml-auto rounded p-1 text-ink-700 transition-colors hover:text-ink-300"
          >
            {copied ? (
              <Check aria-hidden className="size-3 text-emerald-400" />
            ) : (
              <Copy aria-hidden className="size-3" />
            )}
          </button>
        </div>

        {message.fromAssistant ? (
          <RichText text={message.body} />
        ) : (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-100">
            {message.body}
          </p>
        )}

        {message.proposals?.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} />
        ))}
      </div>
    </article>
  )
}

/* -------------------------------------------------------------------------- */

const EXAMPLES = [
  '這部作品現在寫到哪了？',
  '/find 沈知味的廚房',
  '/outline 幫第四集寫大綱',
  '/character 補一下許山河的背景',
]

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-accent-600 text-white"
      >
        <Sparkles className="size-6" />
      </span>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink-100">問我這部戲的事</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-ink-500">
          我看得到作品、集數、小說正文、角色設定、世界觀。
          我不會直接改任何東西——要改會先給你看 diff。
        </p>
      </div>

      <ul className="flex w-full max-w-sm flex-col gap-1.5">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => {
                onPick(example)
                document.getElementById('assistant-draft')?.focus()
              }}
              className="w-full truncate rounded-lg bg-stage-850 px-3 py-2 text-left text-[12px] text-ink-300 ring-1 ring-stage-700 transition-colors hover:bg-stage-800 hover:text-ink-100"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
