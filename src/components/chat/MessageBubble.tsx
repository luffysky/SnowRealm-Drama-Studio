'use client'

import { Check, CheckCheck, Copy, CornerUpLeft, Download, FileText, Phone, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChannelMessage } from '@/components/chat/useChatChannel'
import { assetDownloadUrl, assetPreviewUrl, assetUrl } from '@/lib/asset-url'
import { formatClock, formatVoiceLength } from '@/lib/chat-view'
import { cn } from '@/lib/utils'

/**
 * One message.
 *
 * The actions open on long-press, right-click, or the keyboard — long-press is
 * what the phone expects and right-click is what the desktop expects, and
 * neither is reachable by keyboard, which is why there is a third way in.
 */
export function MessageBubble({
  message,
  mine,
  read,
  onReply,
  onRecall,
}: {
  message: ChannelMessage
  mine: boolean
  /** Whether the other member's read marker has passed this message. */
  read: boolean
  onReply: () => void
  onRecall: () => void
}) {
  const [menu, setMenu] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu) return

    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false)
    }

    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])

  const recalled = Boolean(message.recalledAt)

  // A call line is the thread's own narration, not something either side said.
  if (message.kind === 'CALL') {
    return (
      <p className="my-2 flex items-center justify-center gap-1.5 text-[10px] text-ink-600">
        <Phone aria-hidden className="size-3" />
        {message.body}
        <span className="text-ink-700">{formatClock(new Date(message.createdAt))}</span>
      </p>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn('group relative flex gap-2 py-0.5', mine ? 'justify-end' : 'justify-start')}
      onContextMenu={(event) => {
        if (recalled) return
        event.preventDefault()
        setMenu(true)
      }}
      onTouchStart={() => {
        if (recalled) return
        holdTimer.current = window.setTimeout(() => setMenu(true), 450)
      }}
      onTouchEnd={() => {
        if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
      }}
      onTouchMove={() => {
        // A scroll is not a long press.
        if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
      }}
    >
      {!mine && (
        <span
          aria-hidden
          className="mt-auto grid size-6 shrink-0 place-items-center self-end rounded-full text-[10px] font-semibold text-white"
          style={{ background: message.senderColor }}
        >
          {message.senderName.charAt(0)}
        </span>
      )}

      <div className={cn('flex max-w-[min(32rem,78%)] flex-col gap-0.5', mine && 'items-end')}>
        {message.replyToId && (
          <span
            className={cn(
              'flex max-w-full items-center gap-1 rounded-t-lg border-l-2 px-2 py-1 text-[10px]',
              mine
                ? 'border-accent-400/60 bg-accent-600/10 text-accent-200'
                : 'border-stage-600 bg-stage-850 text-ink-500'
            )}
          >
            <CornerUpLeft aria-hidden className="size-2.5 shrink-0" />
            <span className="truncate">
              {message.replyToSender}：{message.replyToBody}
            </span>
          </span>
        )}

        <div
          className={cn(
            'relative rounded-2xl px-3 py-2 text-xs leading-relaxed',
            recalled
              ? 'bg-stage-850 text-ink-600 italic ring-1 ring-stage-700'
              : mine
                ? 'bg-accent-600 text-white'
                : 'bg-stage-800 text-ink-100'
          )}
        >
          {recalled ? (
            '訊息已收回'
          ) : (
            <Content message={message} mine={mine} />
          )}
        </div>

        <span className="flex items-center gap-1 px-1 text-[9px] text-ink-600 tabular-nums">
          {message.editedAt && !recalled && <span>已編輯</span>}
          {formatClock(new Date(message.createdAt))}
          {mine &&
            !recalled &&
            (read ? (
              <CheckCheck aria-label="已讀" className="size-3 text-accent-400" />
            ) : (
              <Check aria-label="已送出" className="size-3 text-ink-600" />
            ))}
        </span>
      </div>

      {/* ---- actions --------------------------------------------------- */}
      {!recalled && (
        <button
          type="button"
          onClick={() => setMenu((on) => !on)}
          aria-label="訊息選單"
          aria-expanded={menu}
          className={cn(
            'mt-auto mb-5 grid size-6 shrink-0 place-items-center self-end rounded-full text-ink-600 opacity-0 transition-opacity hover:bg-stage-800 hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100',
            mine && 'order-first'
          )}
        >
          ⋯
        </button>
      )}

      {menu && (
        <div
          role="menu"
          className={cn(
            'panel absolute bottom-full z-20 mb-1 flex min-w-36 flex-col rounded-lg bg-stage-850 p-1 ring-1 shadow-xl ring-stage-700',
            mine ? 'right-0' : 'left-8'
          )}
        >
          <MenuItem
            onClick={() => {
              onReply()
              setMenu(false)
            }}
          >
            <CornerUpLeft aria-hidden className="size-3.5" />
            回覆
          </MenuItem>

          {message.body && (
            <MenuItem
              onClick={() => {
                void navigator.clipboard?.writeText(message.body)
                setMenu(false)
              }}
            >
              <Copy aria-hidden className="size-3.5" />
              複製文字
            </MenuItem>
          )}

          {message.assetId && (
            <a
              href={assetDownloadUrl(message.assetId)}
              onClick={() => setMenu(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-800 hover:text-ink-100"
            >
              <Download aria-hidden className="size-3.5" />
              下載檔案
            </a>
          )}

          {mine && (
            <MenuItem
              destructive
              onClick={() => {
                onRecall()
                setMenu(false)
              }}
            >
              <Trash2 aria-hidden className="size-3.5" />
              收回
            </MenuItem>
          )}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Content({ message, mine }: { message: ChannelMessage; mine: boolean }) {
  switch (message.kind) {
    case 'IMAGE':
      return (
        <a href={assetUrl(message.assetId!)} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetPreviewUrl(message.assetId!)}
            alt={message.assetName ?? ''}
            loading="lazy"
            decoding="async"
            className="max-h-72 rounded-lg object-contain"
          />
          {message.body && <p className="mt-1.5">{message.body}</p>}
        </a>
      )

    case 'VIDEO':
      return (
        <>
          { }
          <video
            src={assetUrl(message.assetId!)}
            controls
            // Never `auto`: a thread of clips would open a connection each.
            preload="metadata"
            className="max-h-72 rounded-lg"
          />
          {message.body && <p className="mt-1.5">{message.body}</p>}
        </>
      )

    case 'VOICE':
    case 'AUDIO':
      return (
        <div className="flex min-w-48 flex-col gap-1">
          { }
          <audio src={assetUrl(message.assetId!)} controls preload="metadata" className="h-8 w-full" />
          <span className={cn('text-[10px]', mine ? 'text-white/70' : 'text-ink-500')}>
            {message.kind === 'VOICE' ? '語音訊息' : message.assetName}
            {message.durationSec ? ` · ${formatVoiceLength(message.durationSec)}` : ''}
          </span>
        </div>
      )

    case 'FILE':
      return (
        <a
          href={assetDownloadUrl(message.assetId!)}
          className="flex items-center gap-2 underline-offset-2 hover:underline"
        >
          <FileText aria-hidden className="size-4 shrink-0" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate">{message.assetName}</span>
            {message.assetSize !== null && (
              <span className={cn('text-[10px]', mine ? 'text-white/70' : 'text-ink-500')}>
                {formatBytes(message.assetSize)}
              </span>
            )}
          </span>
        </a>
      )

    default:
      // `whitespace-pre-wrap` so a message written with line breaks keeps them.
      return <p className="break-words whitespace-pre-wrap">{message.body}</p>
  }
}

function MenuItem({
  onClick,
  destructive,
  children,
}: {
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
        destructive
          ? 'text-rose-300 hover:bg-rose-500/10'
          : 'text-ink-300 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
