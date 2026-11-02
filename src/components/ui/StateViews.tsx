'use client'

import { AlertCircle, Inbox, Loader2, Lock, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

/**
 * The shared states every page and dialog must provide (spec §二): empty,
 * loading, error, and permission-denied. Having one implementation each is
 * what keeps 53 UI units consistent.
 */

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      <Loader2 aria-hidden className="size-4 animate-spin text-accent-400" />
      {label ? (
        <span className="text-xs text-ink-400">{label}</span>
      ) : (
        <span className="sr-only">載入中</span>
      )}
    </span>
  )
}

/** Shimmer placeholder. Prefer this over a spinner where the shape is known. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded bg-stage-750', className)}
    />
  )
}

export function LoadingState({
  label = '載入中…',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      <Loader2 aria-hidden className="size-6 animate-spin text-accent-400" />
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-stage-800 ring-1 ring-stage-700">
        {icon ?? <Inbox aria-hidden className="size-5 text-ink-500" />}
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-ink-200">{title}</p>
        {description && (
          <p className="text-xs leading-relaxed text-balance text-ink-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = '載入失敗',
  description,
  onRetry,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-rose-950 ring-1 ring-rose-800">
        <AlertCircle aria-hidden className="size-5 text-rose-400" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-ink-200">{title}</p>
        {description && (
          <p className="text-xs leading-relaxed text-balance text-ink-500">{description}</p>
        )}
      </div>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          leadingIcon={<RefreshCw aria-hidden className="size-3.5" />}
        >
          重試
        </Button>
      )}
    </div>
  )
}

export function PermissionDeniedState({
  description = '你的帳號沒有執行這個操作的權限。',
  className,
}: {
  description?: string
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-stage-800 ring-1 ring-stage-700">
        <Lock aria-hidden className="size-5 text-ink-500" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-ink-200">權限不足</p>
        <p className="text-xs leading-relaxed text-balance text-ink-500">{description}</p>
      </div>
    </div>
  )
}

/**
 * Explicit "this capability is not configured" panel — the state the spec
 * requires wherever an AI feature has no credential (「無 API 時提供明確不可用狀態」).
 * It names what is missing instead of hiding the button.
 */
export function NotConfiguredState({
  title = '尚未設定',
  description,
  missing,
  action,
  className,
}: {
  title?: string
  description?: string
  missing?: readonly string[]
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg bg-stage-900 px-4 py-4 ring-1 ring-stage-700',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-950 ring-1 ring-amber-800">
          <AlertCircle aria-hidden className="size-3.5 text-amber-400" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink-200">{title}</p>
          {description && (
            <p className="text-[11px] leading-relaxed text-ink-500">{description}</p>
          )}
        </div>
      </div>

      {missing && missing.length > 0 && (
        <ul className="flex flex-col gap-1 rounded bg-stage-950/60 px-3 py-2">
          {missing.map((key) => (
            <li key={key} className="font-mono text-[11px] text-amber-300">
              {key}
            </li>
          ))}
        </ul>
      )}

      {action}
    </div>
  )
}
