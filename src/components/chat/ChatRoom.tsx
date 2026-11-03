'use client'

import {
  CornerUpLeft,
  Loader2,
  Mic,
  Paperclip,
  Search,
  Send,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CallPanel } from '@/components/chat/CallPanel'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { useChatChannel, type ChannelMessage, type ChannelSignal } from '@/components/chat/useChatChannel'
import { useToast } from '@/components/ui/Toast'
import { useUploader } from '@/components/studio/useUploader'
import { dayKey, formatDay, kindForMime } from '@/lib/chat-view'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { acceptAnyMedia, resolveMimeType } from '@/lib/media-types'
import { cn } from '@/lib/utils'

/**
 * 對話 (Z99).
 *
 * One room, because the studio is two people. The layout is the one everyone
 * already knows from a messaging app, which is the point: nothing here should
 * need explaining.
 *
 * Attachments ride the existing upload pipeline — the same presigned R2 path
 * the asset centre uses — rather than posting bytes through this route. A
 * 200 MB video through a serverless function would hit the body limit long
 * before it hit the network.
 */

type Props = {
  conversationId: string
  meId: string
  /** Any project, for the uploads to belong to. Chat files are studio-wide. */
  uploadProjectId: string | null
  initialMessages: ChannelMessage[]
  initialSeq: number
  /** From `app_settings`; STUN by default, TURN when configured. */
  iceServers: RTCIceServer[]
}

export function ChatRoom({
  conversationId,
  meId,
  uploadProjectId,
  initialMessages,
  initialSeq,
  iceServers,
}: Props) {
  const toast = useToast()

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChannelMessage[] | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [atTop, setAtTop] = useState(false)

  const signalQueue = useRef<ChannelSignal[]>([])
  const onSignals = useCallback((signals: ChannelSignal[]) => {
    signalQueue.current = [...signalQueue.current, ...signals]
  }, [])

  const channel = useChatChannel({
    conversationId,
    initialMessages,
    initialSeq,
    onSignals,
  })

  const { messages, members, status, absorb, replace, setTyping } = channel

  const others = members.filter((member) => member.userId !== meId)
  const partner = others[0]

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const lastSeenSeq = useRef(initialSeq)

  /* ------------------------------------------------------------- scrolling */

  const nearBottom = () => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 160
  }

  const stickRef = useRef(true)

  useEffect(() => {
    // Only follow new messages when already reading the bottom. Yanking
    // someone back down while they scroll history is the classic chat bug.
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  /* ------------------------------------------------------------ read state */

  useEffect(() => {
    const newest = messages[messages.length - 1]
    if (!newest || newest.seq <= lastSeenSeq.current) return
    if (document.visibilityState !== 'visible') return

    lastSeenSeq.current = newest.seq
    void apiFetch('/api/chat/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, seq: newest.seq }),
    }).catch(() => {})
  }, [messages, conversationId])

  /* ---------------------------------------------------------------- typing */

  const typingTimer = useRef<number | null>(null)

  function onDraft(value: string) {
    setDraft(value)
    setTyping(value.length > 0)

    // Stop claiming someone is typing a few seconds after they stop.
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => setTyping(false), 4000)
  }

  /* ---------------------------------------------------------------- upload */

  const fileRef = useRef<HTMLInputElement | null>(null)

  const uploader = useUploader({
    projectId: uploadProjectId ?? '',
    onComplete: (assetId, file) => {
      const mime = resolveMimeType(file.name, file.type)
      void post({
        kind: kindForMime(mime),
        assetId,
        body: '',
      })
    },
  })

  const uploading = uploader.counts.active

  /* ------------------------------------------------------------- recording */

  const [recording, setRecording] = useState(false)
  const [recordedMs, setRecordedMs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordTimer = useRef<number | null>(null)

  async function startRecording() {
    if (!uploadProjectId) {
      toast.error('還沒有作品', '語音訊息要有一部作品才能存放檔案')
      return
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(media)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        for (const track of media.getTracks()) track.stop()

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 1200) {
          // A tap rather than a hold. Sending a 0.1 second file helps nobody.
          toast.error('太短了', '按住麥克風說完再放開')
          return
        }

        const extension = (recorder.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `語音訊息-${Date.now()}.${extension}`, { type: blob.type })
        uploader.enqueue([file], 'VOICE')
      }

      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
      setRecordedMs(0)
      recordTimer.current = window.setInterval(() => setRecordedMs((ms) => ms + 100), 100)
    } catch {
      toast.error('拿不到麥克風', '請在瀏覽器允許這個網站使用麥克風')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    if (recordTimer.current !== null) window.clearInterval(recordTimer.current)
  }

  /* ---------------------------------------------------------------- sending */

  const post = useCallback(
    async (input: {
      kind: string
      body: string
      assetId?: string | null
      durationSec?: number | null
    }) => {
      setSending(true)
      try {
        const response = await apiFetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            kind: input.kind,
            body: input.body,
            assetId: input.assetId ?? null,
            durationSec: input.durationSec ?? null,
            replyToId: replyTo?.id ?? null,
          }),
        })
        if (!response.ok) throw new Error(await readApiError(response))

        const body = (await response.json()) as { message: ChannelMessage }
        // Shown immediately rather than waiting for the stream to echo it —
        // a message that takes a second to appear feels broken.
        absorb([body.message])
        setReplyTo(null)
        stickRef.current = true
        setTyping(false)
      } catch (cause) {
        toast.error('送出失敗', cause instanceof Error ? cause.message : undefined)
      } finally {
        setSending(false)
      }
    },
    [conversationId, replyTo, absorb, setTyping, toast]
  )

  async function submit() {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    await post({ kind: 'TEXT', body: text })
  }

  /* --------------------------------------------------------------- actions */

  async function edit(message: ChannelMessage, body: string) {
    try {
      const response = await apiFetch(`/api/chat/messages/${message.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = (await response.json()) as { message: ChannelMessage }
      replace(payload.message)
    } catch (cause) {
      toast.error('編輯失敗', cause instanceof Error ? cause.message : undefined)
    }
  }

  async function recall(message: ChannelMessage) {
    try {
      const response = await apiFetch(`/api/chat/messages/${message.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as { message: ChannelMessage }
      replace(body.message)
    } catch (cause) {
      toast.error('收回失敗', cause instanceof Error ? cause.message : undefined)
    }
  }

  /* ---------------------------------------------------------------- history */

  async function loadOlder() {
    const oldest = messages[0]
    if (!oldest || loadingMore) return

    setLoadingMore(true)
    try {
      const response = await apiFetch(
        `/api/chat/messages?conversation=${conversationId}&before=${oldest.seq}`
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { messages: ChannelMessage[] }
      if (body.messages.length === 0) {
        setAtTop(true)
        return
      }

      const el = scrollRef.current
      const before = el?.scrollHeight ?? 0

      channel.setMessages((current) => {
        const byId = new Map(body.messages.map((m) => [m.id, m]))
        for (const m of current) byId.set(m.id, m)
        return [...byId.values()].sort((a, b) => a.seq - b.seq)
      })

      // Hold the reading position: growing the list above the viewport would
      // otherwise throw the reader back to where they started.
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - before
      })
    } catch (cause) {
      toast.error('讀取較早的訊息失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setLoadingMore(false)
    }
  }

  async function runSearch(term: string) {
    const text = term.trim()
    if (!text) {
      setResults(null)
      return
    }

    try {
      const response = await apiFetch(
        `/api/chat/messages?conversation=${conversationId}&q=${encodeURIComponent(text)}&limit=50`
      )
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as { messages: ChannelMessage[] }
      setResults(body.messages)
    } catch (cause) {
      toast.error('搜尋失敗', cause instanceof Error ? cause.message : undefined)
    }
  }

  /* ---------------------------------------------------------------- render */

  const shown = results ?? messages
  const partnerReadSeq = partner?.readSeq ?? 0

  const grouped = useMemo(() => {
    const out: { day: string; items: ChannelMessage[] }[] = []
    for (const message of shown) {
      const key = dayKey(new Date(message.createdAt))
      const last = out[out.length - 1]
      if (last && last.day === key) last.items.push(message)
      else out.push({ day: key, items: [message] })
    }
    return out
  }, [shown])

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {/* ---- header ----------------------------------------------------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stage-700/60 px-3 py-2.5 sm:px-4">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ background: partner?.color ?? '#8b5cf6' }}
        >
          {partner?.name.charAt(0) ?? '?'}
        </span>

        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-ink-50">
            {partner?.name ?? '對話'}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-ink-500">
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full',
                partner?.online ? 'bg-emerald-400' : 'bg-ink-700'
              )}
            />
            {partner?.typing ? '輸入中⋯' : partner?.online ? '線上' : lastSeenLabel(partner)}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <ConnectionDot status={status} />

          <IconButton label="搜尋對話" onClick={() => setSearching((on) => !on)} active={searching}>
            <Search aria-hidden className="size-4" />
          </IconButton>

          <CallPanel
            conversationId={conversationId}
            meId={meId}
            partnerName={partner?.name ?? '對方'}
            call={channel.call}
            setCall={channel.setCall}
            signalQueue={signalQueue}
            iceServers={iceServers}
          />
        </div>
      </header>

      {searching && (
        <div className="shrink-0 border-b border-stage-700/60 px-3 py-2 sm:px-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void runSearch(query)
            }}
            className="relative"
          >
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
            />
            <label className="sr-only" htmlFor="chat-search">
              搜尋對話紀錄
            </label>
            <input
              id="chat-search"
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                if (!event.target.value.trim()) setResults(null)
              }}
              placeholder="搜尋對話紀錄與檔名⋯"
              className="h-8 w-full rounded-lg bg-stage-850 pr-16 pl-8 text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
            {results && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setResults(null)
                }}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-ink-500 hover:text-ink-200"
              >
                {results.length} 筆・清除
              </button>
            )}
          </form>
        </div>
      )}

      {/* ---- thread ----------------------------------------------------- */}
      <div
        ref={scrollRef}
        onScroll={() => {
          stickRef.current = nearBottom()
          if ((scrollRef.current?.scrollTop ?? 1) < 80 && !atTop && !results) void loadOlder()
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        {loadingMore && (
          <p className="pb-3 text-center text-[10px] text-ink-600">讀取較早的訊息⋯</p>
        )}
        {atTop && !results && (
          <p className="pb-3 text-center text-[10px] text-ink-700">這是對話的開頭</p>
        )}

        {shown.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-center text-[11px] leading-relaxed text-ink-600">
              {results ? '沒有符合的訊息' : '還沒有訊息。\n說點什麼開始吧。'}
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <section key={group.day}>
              <p className="my-3 text-center">
                <span className="rounded-full bg-stage-850 px-2.5 py-0.5 text-[10px] text-ink-500">
                  {formatDay(new Date(group.items[0]!.createdAt))}
                </span>
              </p>

              {group.items.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={message.senderId === meId}
                  read={message.seq <= partnerReadSeq}
                  onReply={() => {
                    setReplyTo(message)
                    setResults(null)
                  }}
                  onRecall={() => void recall(message)}
                  onEdit={(body) => edit(message, body)}
                />
              ))}
            </section>
          ))
        )}

        <div ref={bottomRef} />
      </div>

      {/* ---- composer --------------------------------------------------- */}
      <div className="shrink-0 border-t border-stage-700/60 px-3 py-2.5 sm:px-4">
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-stage-850 px-2.5 py-1.5 ring-1 ring-stage-700">
            <CornerUpLeft aria-hidden className="mt-0.5 size-3 shrink-0 text-accent-400" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[10px] text-accent-300">回覆 {replyTo.senderName}</span>
              <span className="truncate text-[11px] text-ink-400">
                {replyTo.recalledAt ? '訊息已收回' : replyTo.body || '［附件］'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="取消回覆"
              className="shrink-0 rounded p-0.5 text-ink-600 hover:text-ink-200"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )}

        {uploading > 0 && (
          <p className="mb-2 flex items-center gap-1.5 text-[10px] text-ink-500">
            <Loader2 aria-hidden className="size-3 animate-spin" />
            上傳中（{uploading}）
          </p>
        )}

        {recording ? (
          <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2 ring-1 ring-rose-500/40">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-rose-400" />
            <span className="text-[11px] text-rose-200 tabular-nums">
              錄音中 {(recordedMs / 1000).toFixed(1)}s
            </span>
            <button
              type="button"
              onClick={stopRecording}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-2.5 py-1.5 text-[11px] font-medium text-white"
            >
              <Square aria-hidden className="size-3" />
              送出
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            className="flex items-end gap-1.5"
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={acceptAnyMedia()}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                if (files.length > 0 && uploadProjectId) {
                  for (const file of files) {
                    const mime = resolveMimeType(file.name, file.type)
                    uploader.enqueue([file], uploadKind(mime))
                  }
                }
                event.target.value = ''
              }}
              className="hidden"
            />

            <IconButton
              label="傳檔案"
              onClick={() => {
                if (!uploadProjectId) {
                  toast.error('還沒有作品', '傳檔案要有一部作品才能存放檔案')
                  return
                }
                fileRef.current?.click()
              }}
            >
              <Paperclip aria-hidden className="size-4" />
            </IconButton>

            <IconButton label="按住錄語音" onClick={() => void startRecording()}>
              <Mic aria-hidden className="size-4" />
            </IconButton>

            <label className="sr-only" htmlFor="chat-draft">
              訊息
            </label>
            <textarea
              id="chat-draft"
              rows={1}
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line — what everyone
                // expects, and what makes a newline reachable on a phone too.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder="輸入訊息⋯"
              className="max-h-32 min-h-9 flex-1 resize-none rounded-xl bg-stage-850 px-3 py-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />

            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="送出"
              className="bg-brand-gradient glow-accent-sm grid size-9 shrink-0 place-items-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {sending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Send aria-hidden className="size-4" />
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function uploadKind(mime: string) {
  if (mime.startsWith('image/')) return 'IMAGE' as const
  if (mime.startsWith('video/')) return 'VIDEO' as const
  if (mime.startsWith('audio/')) return 'VOICE' as const
  return 'DOC' as const
}

function lastSeenLabel(member: { lastSeenAt: string | null } | undefined): string {
  if (!member?.lastSeenAt) return '離線'

  const minutes = Math.floor((Date.now() - new Date(member.lastSeenAt).getTime()) / 60000)
  if (minutes < 1) return '剛剛還在'
  if (minutes < 60) return `${minutes} 分鐘前上線`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前上線`
  return `${Math.floor(hours / 24)} 天前上線`
}

function ConnectionDot({ status }: { status: string }) {
  const label =
    status === 'live'
      ? '即時連線中'
      : status === 'polling'
        ? '改用輪詢（每 3 秒）'
        : status === 'connecting'
          ? '連線中⋯'
          : '連線中斷'

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'mr-1 size-1.5 rounded-full',
        status === 'live'
          ? 'bg-emerald-400'
          : status === 'polling'
            ? 'bg-amber-400'
            : status === 'connecting'
              ? 'animate-pulse bg-ink-500'
              : 'bg-rose-400'
      )}
    />
  )
}

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
        active
          ? 'bg-accent-600/25 text-accent-300'
          : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}
