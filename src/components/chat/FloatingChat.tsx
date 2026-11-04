'use client'

import { MessageSquare, Minus, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CallPanel } from '@/components/chat/CallPanel'
import { MessageBubble } from '@/components/chat/MessageBubble'
import {
  useChatChannel,
  type ChannelMessage,
  type ChannelSignal,
} from '@/components/chat/useChatChannel'
import { notify, requestNotifications, useNotificationPermission } from '@/lib/notifications'
import { apiFetch, readApiError } from '@/lib/client-fetch'

/**
 * 懸浮對話球.
 *
 * Mounted once in the studio shell, so it is live on every page. That is not
 * a convenience — it is the only way an incoming call can ring anywhere. The
 * call panel used to live inside the chat page, so the phone only rang if you
 * happened to already be looking at the conversation.
 *
 * It collapses to a button and remembers that, because a panel that reopens
 * itself on every navigation is a panel people close permanently.
 *
 * On `/chat` it hides entirely: the full room is already on screen, and two
 * live connections to the same thread would double every query for nothing.
 */

const STORAGE_KEY = 'srds.floatingChat.v1'

/**
 * Keeps the widget off a page's own bottom-right control.
 *
 * It is `fixed right bottom`, so on a page whose primary action lives in the
 * same corner it sits on top of it. On the assistant page at phone width the
 * ball covered the send button almost completely — the composer was there,
 * the text went in, and the button could not be pressed.
 *
 * A page that owns that corner publishes its height as `--dock-height` on the
 * root element (`useBottomDock`), and the widget rides above it. Pages that do
 * not set it are unaffected: the fallback is 0.
 */
const clearance = (gap: string) => ({ bottom: `calc(var(--dock-height, 0px) + ${gap})` })
const DOCK_CLEARANCE = clearance('0.5rem')
const DOCK_CLEARANCE_BALL = clearance('1rem')

export function FloatingChat({
  conversationId,
  meId,
  iceServers,
}: {
  conversationId: string
  meId: string
  /** From `app_settings`; STUN by default, TURN when configured. */
  iceServers: RTCIceServer[]
}) {
  const pathname = usePathname()
  const [state, setState] = useState<'hidden' | 'ball' | 'open'>('ball')
  const restored = useRef(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [ready, setReady] = useState(false)

  const signalQueue = useRef<ChannelSignal[]>([])
  const onSignals = useCallback((signals: ChannelSignal[]) => {
    signalQueue.current = [...signalQueue.current, ...signals]
  }, [])

  const channel = useChatChannel({
    conversationId,
    initialMessages: [],
    // 0 would replay the whole thread into a widget nobody has opened.
    // `-1` is a sentinel the hook turns into "from the latest", below.
    initialSeq: 0,
    onSignals,
  })

  const { messages, members, call, setCall, absorb, replace } = channel
  const partner = members.find((member) => member.userId !== meId)

  const permission = useNotificationPermission()

  /* ------------------------------------------------------------- restored */

  /*
   * Deferred to a microtask so the state write is not synchronous inside the
   * effect — what `react-hooks/set-state-in-effect` forbids. `localStorage`
   * does not exist during the server render, so it cannot be a lazy
   * initialiser without a hydration mismatch.
   */
  useEffect(() => {
    if (restored.current) return
    restored.current = true

    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (stored === 'hidden' || stored === 'ball' || stored === 'open') setState(stored)
      } catch {
        // Private window or blocked storage; the default is fine.
      }
      setReady(true)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const persist = useCallback((next: 'hidden' | 'ball' | 'open') => {
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not worth interrupting anyone over.
    }
  }, [])

  /* -------------------------------------------------------- notifications */

  const seenRef = useRef<string | null>(null)
  const unreadRef = useRef(0)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    const newest = messages[messages.length - 1]
    if (!newest) return
    if (seenRef.current === null) {
      // First batch after connecting is history, not news.
      seenRef.current = newest.id
      return
    }
    if (seenRef.current === newest.id) return
    seenRef.current = newest.id

    if (newest.senderId === meId) return

    // Only when the panel is not already showing it.
    const visible = state === 'open' && document.visibilityState === 'visible'
    if (!visible) {
      unreadRef.current += 1
      setUnread(unreadRef.current)

      notify({
        title: newest.senderName,
        body: newest.recalledAt ? '訊息已收回' : newest.body || '傳送了一個檔案',
        tag: 'srds-chat',
      })
    }
  }, [messages, meId, state])

  useEffect(() => {
    if (state !== 'open' || unreadRef.current === 0) return

    const timer = window.setTimeout(() => {
      unreadRef.current = 0
      setUnread(0)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [state, messages])

  /*
   * A ringing call is the one thing that opens the panel by itself. It is
   * also the one thing where that is right: a phone that rings silently in a
   * collapsed widget is not a phone.
   */
  const ringingRef = useRef<string | null>(null)

  useEffect(() => {
    if (!call || call.state !== 'RINGING' || call.callerId === meId) return
    if (ringingRef.current === call.id) return
    ringingRef.current = call.id

    setState('open')
    notify({
      title: `${partner?.name ?? '工作室'} 來電`,
      body: call.video ? '視訊通話' : '語音通話',
      tag: 'srds-call',
      requireInteraction: true,
    })
  }, [call, meId, partner])

  /* ---------------------------------------------------------------- send */

  async function submit() {
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    setDraft('')
    try {
      const response = await apiFetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, kind: 'TEXT', body: text }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { message: ChannelMessage }
      absorb([body.message])
    } catch {
      // Put it back so nothing is lost.
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  /* --------------------------------------------------------------- render */

  /*
   * Mounted whatever the widget is doing, including collapsed and hidden.
   *
   * It used to live inside the expanded panel, which quietly undid the whole
   * point of moving it out of the chat page: with the ball collapsed there
   * was no call panel in the tree, so the phone did not ring and dialling
   * from the widget did nothing. Hiding it is a CSS concern; being mounted is
   * not.
   */
  const callPanel = (
    <CallPanel
      conversationId={conversationId}
      meId={meId}
      partnerName={partner?.name ?? '對方'}
      call={call}
      setCall={setCall}
      signalQueue={signalQueue}
      iceServers={iceServers}
    />
  )

  // The full room is already on screen; a second live channel to the same
  // thread would double every query to show the same messages.
  if (!ready || pathname.startsWith('/chat')) return null

  if (state === 'hidden') {
    return (
      <>
        {/* The dial buttons are hidden; the ringing panel is not. */}
        <span className="hidden">{callPanel}</span>

        <button
          type="button"
          onClick={() => persist('ball')}
          aria-label="顯示對話"
          title="顯示對話"
          style={DOCK_CLEARANCE}
          className="tap fixed right-2 bottom-2 z-30 grid size-7 place-items-center rounded-full bg-stage-800/70 text-ink-600 ring-1 ring-stage-700 transition-colors hover:text-ink-200"
        >
          <MessageSquare aria-hidden className="size-3.5" />
        </button>
      </>
    )
  }

  if (state === 'ball') {
    return (
      <div style={DOCK_CLEARANCE_BALL} className="fixed right-4 bottom-4 z-40 flex items-center gap-1.5">
        {/* Collapsed, but still able to ring. */}
        <span className="hidden">{callPanel}</span>

        <button
          type="button"
          onClick={() => persist('hidden')}
          aria-label="關閉懸浮對話"
          title="關閉（之後可從右下角小圖示叫回來）"
          className="grid size-7 place-items-center rounded-full bg-stage-850 text-ink-600 opacity-0 ring-1 ring-stage-700 transition-opacity hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-60"
        >
          <X aria-hidden className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => persist('open')}
          aria-label={unread > 0 ? `對話，${unread} 則未讀` : '對話'}
          className="bg-brand-gradient glow-accent relative grid size-14 place-items-center rounded-full text-white transition-transform hover:scale-105"
        >
          <MessageSquare aria-hidden className="size-6" />

          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}

          {partner?.online && (
            <span
              aria-hidden
              className="absolute right-0.5 bottom-0.5 size-3 rounded-full bg-emerald-400 ring-2 ring-stage-950"
            />
          )}
        </button>
      </div>
    )
  }

  return (
    <div
      style={DOCK_CLEARANCE}
      className="panel fixed right-2 bottom-2 z-40 flex max-h-[min(32rem,calc(100dvh-5rem))] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl bg-stage-850 ring-1 shadow-2xl ring-stage-700"
      role="dialog"
      aria-label="對話"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-stage-700/60 px-3 py-2">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
          style={{ background: partner?.color ?? '#8b5cf6' }}
        >
          {partner?.name.charAt(0) ?? '?'}
        </span>

        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-xs font-medium text-ink-50">
            {partner?.name ?? '對話'}
          </span>
          <span className="text-[10px] text-ink-500">
            {partner?.typing ? '輸入中⋯' : partner?.online ? '線上' : '離線'}
          </span>
        </span>

        {callPanel}

        <Link
          href="/chat"
          aria-label="開啟完整對話"
          title="開啟完整對話"
          className="tap grid size-7 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
        >
          <MessageSquare aria-hidden className="size-3.5" />
        </Link>

        <button
          type="button"
          onClick={() => persist('ball')}
          aria-label="收起"
          className="tap grid size-7 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
        >
          <Minus aria-hidden className="size-3.5" />
        </button>
      </header>

      {permission === 'default' && (
        <button
          type="button"
          onClick={() => void requestNotifications()}
          className="shrink-0 border-b border-stage-700/60 bg-accent-600/10 px-3 py-1.5 text-left text-[10px] text-accent-200 transition-colors hover:bg-accent-600/20"
        >
          開啟通知，才收得到來電與新訊息 →
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[11px] leading-relaxed text-ink-600">
            這裡只顯示你開著它之後的訊息。
            <br />
            完整紀錄在「訊息」頁。
          </p>
        ) : (
          messages
            .slice(-30)
            .map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                mine={message.senderId === meId}
                read={message.seq <= (partner?.readSeq ?? 0)}
                onReply={() => setDraft(`「${message.body.slice(0, 20)}」 `)}
                onRecall={() => void recall(message)}
              />
            ))
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex shrink-0 items-end gap-1.5 border-t border-stage-700/60 p-2"
      >
        <label className="sr-only" htmlFor="floating-draft">
          訊息
        </label>
        <textarea
          id="floating-draft"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="輸入訊息⋯"
          className="max-h-24 min-h-8 flex-1 resize-none rounded-lg bg-stage-900 px-2.5 py-1.5 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="送出"
          className="bg-brand-gradient grid size-8 shrink-0 place-items-center rounded-full text-white disabled:opacity-40"
        >
          <MessageSquare aria-hidden className="size-3.5" />
        </button>
      </form>
    </div>
  )

  async function recall(message: ChannelMessage) {
    const response = await apiFetch(`/api/chat/messages/${message.id}`, { method: 'DELETE' })
    if (!response.ok) return
    const body = (await response.json()) as { message: ChannelMessage }
    replace(body.message)
  }
}
