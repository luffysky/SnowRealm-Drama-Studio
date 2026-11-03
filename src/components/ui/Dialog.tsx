'use client'

import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

/**
 * Modal / drawer / fullscreen overlay.
 *
 * Interaction rules the spec requires of every dialog (§二):
 * - Escape closes, but routes through `onRequestClose` so a dirty form can
 *   intercept and ask first — cancelling must never silently discard edits.
 * - Focus is trapped inside while open and returned to the trigger on close.
 * - The page behind cannot scroll.
 * - Narrow screens get a bottom sheet instead of a centred card.
 */

type Variant = 'modal' | 'drawer' | 'fullscreen'

const PANEL: Record<Variant, string> = {
  modal:
    'w-full max-w-2xl rounded-xl sm:my-8 ' +
    'max-sm:mt-auto max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none',
  drawer: 'ml-auto h-full w-full max-w-xl rounded-none sm:rounded-l-xl animate-slide-left',
  fullscreen: 'h-full w-full max-w-none rounded-none',
}

export type DialogProps = {
  open: boolean
  /** Called for Escape, backdrop click, and the close button. */
  onRequestClose: () => void
  title: string
  description?: string
  variant?: Variant
  /** Pinned action row at the bottom. */
  footer?: ReactNode
  /** Disables backdrop / Escape dismissal while an action is in flight. */
  busy?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
  className?: string
}

const SIZE: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-6xl',
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  onRequestClose,
  title,
  description,
  variant = 'modal',
  footer,
  busy = false,
  size = 'md',
  children,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  /*
   * `document` does not exist during the server render, and the portal needs
   * it. `useSyncExternalStore` rather than an effect: setting state in one is
   * what `react-hooks/set-state-in-effect` forbids, and this is exactly the
   * "read a client-only value" case it is for.
   */
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )

  // Remember what had focus so it can be restored when the dialog closes.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null
    } else {
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  // Move focus in, preferring the first real control over the close button.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const timer = window.setTimeout(() => {
      const candidates = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.dataset.dialogClose
      )
      ;(candidates[0] ?? panel).focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [open])

  // Lock background scroll without the content jumping as the bar disappears.
  useEffect(() => {
    if (!open) return
    const { body } = document
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = previousOverflow
    }
  }, [open])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        if (busy) return
        event.stopPropagation()
        onRequestClose()
        return
      }

      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      )
      if (focusable.length === 0) return

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [busy, onRequestClose]
  )

  if (!open || !mounted) return null

  const labelId = `${title.replace(/\s+/g, '-')}-dialog-title`

  /*
   * Rendered into `document.body`, not where it was written.
   *
   * `position: fixed` is relative to the viewport only while no ancestor has a
   * transform, filter or backdrop-filter — any of those makes the ancestor the
   * containing block instead. The navigation rail has `transition-transform`
   * for its slide-over, so a dialog opened from a button inside it rendered
   * trapped in a 256px column rather than centred on screen.
   *
   * Portalling fixes every dialog, including ones not yet written.
   */
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex animate-fade-in',
        variant === 'modal' && 'items-end justify-center sm:items-center sm:p-4',
        variant === 'drawer' && 'justify-end',
        variant === 'fullscreen' && 'p-0'
      )}
      onKeyDown={handleKeyDown}
    >
      <div
        aria-hidden
        onClick={busy ? undefined : onRequestClose}
        className="absolute inset-0 bg-stage-950/80 backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-full flex-col overflow-hidden',
          'bg-stage-850 ring-1 ring-stage-700 panel shadow-2xl shadow-stage-950/80',
          variant === 'modal' && 'animate-rise',
          PANEL[variant],
          variant === 'modal' && SIZE[size],
          className
        )}
      >
        <header className="flex items-start gap-4 border-b border-stage-700 px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={labelId} className="truncate text-sm font-semibold text-ink-50">
              {title}
            </h2>
            {description && <p className="text-xs leading-relaxed text-ink-500">{description}</p>}
          </div>

          <Button
            data-dialog-close
            variant="ghost"
            size="icon"
            aria-label="關閉"
            disabled={busy}
            onClick={onRequestClose}
            className="ml-auto -mt-1 -mr-1"
            leadingIcon={<X aria-hidden className="size-4" />}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {footer && (
          <footer
            className={cn(
              'flex flex-wrap items-center justify-end gap-2',
              'border-t border-stage-700 bg-stage-900/60 px-5 py-3',
              // Keep the action row clear of the phone's home indicator.
              'pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3'
            )}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  )
}

/** The document is there or it is not; there is nothing to subscribe to. */
function subscribeNever() {
  return () => {}
}
