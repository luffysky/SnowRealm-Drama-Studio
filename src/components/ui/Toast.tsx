'use client'

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * Toasts for save confirmations and failures.
 *
 * The container is an `aria-live` region so a screen reader announces results
 * without stealing focus. Errors do not auto-dismiss: a failure the user did
 * not see is a failure they will not act on.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export type Toast = {
  id: string
  tone: ToastTone
  title: string
  description?: string
  /** 0 keeps it until dismissed. Errors default to 0. */
  durationMs?: number
  action?: { label: string; onClick: () => void }
}

type ToastInput = Omit<Toast, 'id'>

type ToastContextValue = {
  toasts: Toast[]
  push: (toast: ToastInput) => string
  dismiss: (id: string) => void
  /** Convenience wrappers. */
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  warning: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return context
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  // Errors stay until dismissed.
  error: 0,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (input: ToastInput) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const duration = input.durationMs ?? DEFAULT_DURATION[input.tone]

      setToasts((current) => [...current.slice(-4), { ...input, id }])

      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }

      return id
    },
    [dismiss]
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer)
      map.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (title, description) => push({ tone: 'success', title, ...(description ? { description } : {}) }),
      error: (title, description) => push({ tone: 'error', title, ...(description ? { description } : {}) }),
      warning: (title, description) => push({ tone: 'warning', title, ...(description ? { description } : {}) }),
      info: (title, description) => push({ tone: 'info', title, ...(description ? { description } : {}) }),
    }),
    [dismiss, push, toasts]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

const TONE_STYLE: Record<ToastTone, { ring: string; icon: ReactNode }> = {
  success: {
    ring: 'ring-emerald-700/70',
    icon: <CheckCircle2 aria-hidden className="size-4 text-emerald-400" />,
  },
  error: {
    ring: 'ring-rose-700/70',
    icon: <XCircle aria-hidden className="size-4 text-rose-400" />,
  },
  warning: {
    ring: 'ring-amber-700/70',
    icon: <AlertTriangle aria-hidden className="size-4 text-amber-400" />,
  },
  info: {
    ring: 'ring-sky-700/70',
    icon: <Info aria-hidden className="size-4 text-sky-400" />,
  },
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  return (
    <div
      // Polite: a save confirmation should not interrupt what is being read.
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed z-[60] flex flex-col gap-2',
        'right-4 bottom-4 left-4 sm:left-auto sm:w-96',
        'pb-[env(safe-area-inset-bottom)]'
      )}
    >
      {toasts.map((toast) => {
        const tone = TONE_STYLE[toast.tone]
        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg',
              'bg-stage-850 px-4 py-3 ring-1 panel shadow-xl shadow-stage-950/70',
              tone.ring
            )}
          >
            <span className="mt-px shrink-0">{tone.icon}</span>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-xs font-medium text-ink-50">{toast.title}</p>
              {toast.description && (
                <p className="text-[11px] leading-relaxed break-words text-ink-400">
                  {toast.description}
                </p>
              )}
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick()
                    onDismiss(toast.id)
                  }}
                  className="mt-1 self-start text-[11px] font-medium text-accent-400 hover:text-accent-300 hover:underline"
                >
                  {toast.action.label}
                </button>
              )}
            </div>

            <button
              type="button"
              aria-label="關閉通知"
              onClick={() => onDismiss(toast.id)}
              className="-mt-0.5 -mr-1 shrink-0 rounded p-1 text-ink-600 hover:bg-stage-800 hover:text-ink-200"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
