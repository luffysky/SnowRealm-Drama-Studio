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
import { useDraggableBall } from '@/components/chat/useDraggableBall'
import { cn } from '@/lib/utils'
import { useViewportFit } from '@/components/chat/useViewportFit'

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
const bottomExpr = (gap: string, obscured: number) =>
  `(var(--dock-height, 0px) + var(--safe-bottom, 0px) + ${obscured}px + ${gap})`

const clearance = (gap: string, obscured = 0) => ({
  bottom: `calc${bottomExpr(gap, obscured)}`,
})

/** The tallest the panel may be, as a Tailwind-free max-height. */
const PANEL_MAX_HEIGHT = '32rem'

/**
 * 對話框不可以超出視口 (Z158).
 *
 * 高度和它被頂高多少**必須從同一個算式來**。這裡本來不是：`bottom` 是
 * 動態的（`--dock-height` + 安全區 + 鍵盤遮住的高度），而 `max-height` 寫死
 * 成 `calc(100dvh - 5rem)`——那個 5rem 跟它實際被頂高多少沒有任何關係。
 *
 * 所以只要下方的工具列加上鍵盤超過 5rem，面板的**上緣就跑到畫面外**：標題
 * 列、關閉鈕、通話鈕全部在視口上面，而且捲不到——`fixed` 的東西不在捲動流
 * 裡。手機上打字的時候最容易遇到，因為那正是 `obscured` 最大的時候。
 *
 * 兩個值共用 `bottomExpr`，所以它們不可能再各說各話。這跟估價那個
 * `{ estimate }` 的形狀是同一類錯：兩邊各自寫一次，然後安靜地對不起來。
 */
const panelBox = (gap: string, obscured = 0) => ({
  bottom: `calc${bottomExpr(gap, obscured)}`,
  maxHeight:
    `min(${PANEL_MAX_HEIGHT}, ` +
    `calc(100dvh - ${bottomExpr(gap, obscured)} - var(--safe-top, 0px) - ${gap}))`,
})


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
  /** 鍵盤、瀏海、有沒有人在打字 (P0-2)。 */
  const viewport = useViewportFit()

  /** 拖得動，而且記得放在哪 (Z120)。 */
  const {
    ref: ballRef,
    position: ballPosition,
    dragging: ballDragging,
    justDragged,
    handlers: ballHandlers,
  } = useDraggableBall(56, viewport.obscured)
  const [state, setState] = useState<'hidden' | 'ball' | 'open'>('ball')
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
    /*
     * **沒有 `restored.current` 這道守衛** (Z196).
     *
     * 原本有，而它在 StrictMode 下會把自己鎖死：第一次掛載把旗標設成 true 並
     * 排一個 timer，cleanup 把 timer 取消，第二次掛載因為旗標已經是 true 直接
     * return——於是 `setReady(true)` 永遠不會跑，而下面那行 `if (!ready) return
     * null` 讓整個懸浮對話在開發環境裡**從來不出現**。
     *
     * 正式站沒有 StrictMode 的雙重掛載所以看不出來，而「只有 dev 壞」的意思
     * 是：在本機沒有人驗得了這個元件的任何一行。
     *
     * 拿掉旗標之後 dev 會多讀一次 localStorage。那沒有任何代價。
     */
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
        url: '/chat',
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
      url: '/chat',
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
          style={clearance('0.5rem', viewport.obscured)}
          className="tap fixed right-2 bottom-2 z-30 grid size-7 place-items-center rounded-full bg-stage-800/70 text-ink-600 ring-1 ring-stage-700 transition-colors hover:text-ink-200"
        >
          <MessageSquare aria-hidden className="size-3.5" />
        </button>
      </>
    )
  }

  if (state === 'ball') {
    return (
      <div
        ref={ballRef}
        {...ballHandlers}
        /*
         * 可以拖走 (Z120).
         *
         * Once it has been moved, its own coordinates win over the corner the
         * class sets — and `bottom`/`right` have to be cleared or the two
         * fight and it lands somewhere neither asked for.
         */
        style={
          ballPosition
            ? { left: ballPosition.x, top: ballPosition.y, right: 'auto', bottom: 'auto' }
            : clearance('1rem', viewport.obscured)
        }
        className={cn(
          // `group` 是給關閉鍵的 `group-hover:` 用的——少了它，那一條規則永遠
          // 不會命中。見下面那顆按鈕的註解。
          'group fixed right-4 bottom-4 z-40 flex touch-none items-center gap-1.5',
          ballDragging ? 'cursor-grabbing' : 'cursor-grab',
          // No transition while dragging, or it lags behind the finger.
          !ballDragging && 'transition-[left,top,opacity,transform] duration-200',
          /*
           * 有人在打字就讓開 (P0-2).
           *
           * Shrunk and faded rather than hidden: it still rings, and
           * something that vanishes while you type reads as having crashed.
           * Hover or focus brings it straight back.
           */
          viewport.typing && 'scale-75 opacity-40 hover:scale-100 hover:opacity-100'
        )}
      >
        {/* Collapsed, but still able to ring. */}
        <span className="hidden">{callPanel}</span>

        <button
          type="button"
          onClick={() => persist('hidden')}
          aria-label="關閉懸浮對話"
          title="關閉（之後可從右下角小圖示叫回來）"
          /*
           * 看得見，而且在每一個寬度上都看得見 (Z196).
           *
           * 原本是 `opacity-0 … group-hover:opacity-100 sm:opacity-60`，而這個
           * 檔案裡**沒有任何 `.group` 祖先**（掛載鏈上那個 `role="group"` 是
           * ARIA，不是 Tailwind）。所以 `sm` 以下它永遠是透明的——但照樣佔
           * 28px 而且按得下去。誤觸就把懸浮對話永久關掉，而 `title` 裡承諾的
           * 救援路徑「從右下角小圖示叫回來」那顆圖示也是隱形的同一顆。
           *
           * 現在底線是 `opacity-60`（看得見、不搶戲），滑過去才全亮。`.group`
           * 也補到上面那層了，所以桌機的 hover 真的會作用。
           */
          className="grid size-7 place-items-center rounded-full bg-stage-850 text-ink-600 opacity-60 ring-1 ring-stage-700 transition-opacity hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X aria-hidden className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            // A drag that ends on the ball must not also open the panel.
            if (justDragged()) return
            persist('open')
          }}
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
      /*
       * 高度跟著它被頂高多少一起算 (Z158)。`max-h` 的 class 拿掉了——留著會
       * 跟這個 style 說兩件不一樣的事，而贏的是 style，看程式的人會被騙。
       */
      style={panelBox('0.5rem', viewport.obscured)}
      className="panel fixed right-2 bottom-2 z-40 flex w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl bg-stage-850 ring-1 shadow-2xl ring-stage-700"
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
