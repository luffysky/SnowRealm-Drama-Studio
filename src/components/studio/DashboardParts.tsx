'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Presentational pieces for the dashboard (design 01).
 *
 * Every one of these takes its numbers as props — the page computes them from
 * real rows. Nothing here invents a figure, because spec v2 §0 is explicit that
 * the values in the mockup are illustrative and must not be hard-coded.
 */

/* ------------------------------------------------------------------ tiles */

export type StatTone = 'default' | 'warn' | 'danger' | 'gilt'

const TILE_TONE: Record<StatTone, string> = {
  default: 'ring-stage-700',
  warn: 'ring-amber-600/50 shadow-[0_0_20px_-8px_var(--color-gilt-400)]',
  danger: 'ring-rose-600/50 shadow-[0_0_20px_-8px_#f43f5e]',
  gilt: 'ring-gilt-500/50',
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'default',
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  icon?: ReactNode
  tone?: StatTone
}) {
  return (
    <div
      className={cn(
        'panel flex flex-col gap-1 rounded-xl bg-stage-900 px-4 py-3 ring-1',
        TILE_TONE[tone]
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-ink-500">{icon}</span>}
        <span className="truncate text-[11px] text-ink-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl leading-none font-semibold tracking-tight text-ink-50">
          {value}
        </span>
        {unit && <span className="text-[11px] text-ink-500">{unit}</span>}
      </div>
      {hint && <span className="truncate text-[10px] text-ink-600">{hint}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ panel */

export function Panel({
  title,
  action,
  icon,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700', className)}
    >
      <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-3">
        {icon && <span className="text-accent-400">{icon}</span>}
        <h2 className="text-xs font-semibold text-ink-100">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  )
}

/** A header action that is not wired up yet — informational, never a dead link. */
export function PendingAction({ label, milestone }: { label: string; milestone: string }) {
  return (
    <span
      aria-disabled="true"
      title={`${label}尚未實作，預計於 ${milestone} 階段交付`}
      className="cursor-default text-[11px] text-ink-600 transition-colors hover:text-ink-400"
    >
      {label}（{milestone}）
    </span>
  )
}

/* ------------------------------------------------------------------ donut */

export type DonutSlice = { label: string; value: number; color: string }

/**
 * Spend breakdown ring. Rendered as inline SVG rather than a chart library —
 * one ring of at most eight slices does not justify the dependency, and this
 * keeps the colours on the design system's tokens.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  emptyMessage,
}: {
  slices: DonutSlice[]
  centerLabel: string
  centerValue: string
  emptyMessage: string
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)

  if (total <= 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div
          aria-hidden
          className="size-28 rounded-full border-[14px] border-stage-800"
        />
        <p className="text-[11px] text-ink-600">{emptyMessage}</p>
      </div>
    )
  }

  // Stroke-dasharray on a circle: each slice's length is its share of the
  // circumference, offset by everything before it. Offsets are resolved up
  // front rather than accumulated during the map, so render stays pure.
  const radius = 54
  const circumference = 2 * Math.PI * radius

  const arcs = slices.reduce<{ slice: DonutSlice; dash: number; offset: number }[]>(
    (acc, slice) => {
      const consumed = acc.reduce((sum, a) => sum + a.dash, 0)
      acc.push({
        slice,
        dash: (slice.value / total) * circumference,
        offset: -consumed,
      })
      return acc
    },
    []
  )

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0">
        <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={centerLabel}>
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--color-stage-800)"
            strokeWidth="18"
          />
          {arcs.map(({ slice, dash, offset }) => (
            <circle
              key={slice.label}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth="18"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              transform="rotate(-90 70 70)"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-semibold text-ink-50">{centerValue}</span>
          <span className="text-[9px] text-ink-600">{centerLabel}</span>
        </div>
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2 text-[11px]">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-300">{slice.label}</span>
            <span className="shrink-0 text-ink-400">
              {((slice.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------- bars */

export function MeterRow({
  label,
  icon,
  value,
  max,
  trailing,
}: {
  label: string
  icon?: ReactNode
  value: number
  max: number
  trailing: string
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0

  return (
    <div className="flex items-center gap-2.5">
      {icon && <span className="shrink-0 text-ink-500">{icon}</span>}
      <span className="w-16 shrink-0 truncate text-[11px] text-ink-300">{label}</span>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800"
      >
        <div
          className={cn('h-full rounded-full', pct > 0 && 'bg-brand-gradient')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] text-ink-400">{trailing}</span>
    </div>
  )
}

/* -------------------------------------------------------------- quick ops */

export function QuickAction({
  label,
  icon,
  milestone,
}: {
  label: string
  icon: ReactNode
  milestone?: string
}) {
  const pending = Boolean(milestone)

  return (
    <span
      aria-disabled={pending || undefined}
      title={pending ? `${label}尚未實作，預計於 ${milestone} 階段交付` : label}
      className={cn(
        'flex cursor-default flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 ring-1 transition-colors',
        pending
          ? 'bg-stage-850/60 text-ink-600 ring-stage-700/60 hover:bg-stage-800/60 hover:text-ink-400'
          : 'bg-stage-850 text-ink-200 ring-stage-700 hover:bg-stage-800'
      )}
    >
      <span className={pending ? 'text-ink-700' : 'text-accent-400'}>{icon}</span>
      <span className="text-center text-[10px] leading-tight">{label}</span>
      {pending && <span className="text-[9px] text-ink-700">{milestone}</span>}
    </span>
  )
}
