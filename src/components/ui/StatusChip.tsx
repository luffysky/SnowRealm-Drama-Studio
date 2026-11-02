'use client'

import type { ReactNode } from 'react'
import {
  AI_JOB_STATUS_LABEL,
  AI_JOB_STATUS_STYLE,
  EPISODE_STATUS_LABEL,
  EPISODE_STATUS_STYLE,
  SHOT_STATUS_LABEL,
  SHOT_STATUS_STYLE,
  STAGE_STATE_LABEL,
  STAGE_STATE_STYLE,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_STYLE,
  type AiJobStatusValue,
  type EpisodeStatusValue,
  type ShotStatusValue,
  type StageStateValue,
  type TaskPriorityValue,
} from '@/lib/constants'
import { cn } from '@/lib/utils'

/** Generic chip. The typed wrappers below are what pages should use. */
export function Chip({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
        'text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        className
      )}
    >
      {children}
    </span>
  )
}

export function EpisodeStatusChip({ status }: { status: EpisodeStatusValue }) {
  return <Chip className={EPISODE_STATUS_STYLE[status]}>{EPISODE_STATUS_LABEL[status]}</Chip>
}

export function ShotStatusChip({ status }: { status: ShotStatusValue }) {
  return <Chip className={SHOT_STATUS_STYLE[status]}>{SHOT_STATUS_LABEL[status]}</Chip>
}

export function StageStateChip({ state }: { state: StageStateValue }) {
  return <Chip className={STAGE_STATE_STYLE[state]}>{STAGE_STATE_LABEL[state]}</Chip>
}

export function AiJobStatusChip({ status }: { status: AiJobStatusValue }) {
  return <Chip className={AI_JOB_STATUS_STYLE[status]}>{AI_JOB_STATUS_LABEL[status]}</Chip>
}

export function TaskPriorityChip({ priority }: { priority: TaskPriorityValue }) {
  return <Chip className={TASK_PRIORITY_STYLE[priority]}>{TASK_PRIORITY_LABEL[priority]}</Chip>
}

/** Member avatar dot, coloured by that member's accent. */
export function MemberDot({
  name,
  color,
  size = 'md',
}: {
  name: string
  color: string
  size?: 'sm' | 'md'
}) {
  const initial = name.trim().charAt(0) || '?'
  return (
    <span
      title={name}
      aria-label={name}
      style={{ backgroundColor: `${color}22`, color, borderColor: `${color}66` }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border font-medium',
        size === 'sm' ? 'size-5 text-[10px]' : 'size-6 text-[11px]'
      )}
    >
      {initial}
    </span>
  )
}

/** Thin progress bar used on episode cards and the dashboard. */
export function ProgressBar({
  value,
  label,
  className,
  tone = 'accent',
}: {
  /** 0..1 */
  value: number
  label?: string
  className?: string
  tone?: 'accent' | 'gilt' | 'emerald'
}) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  const bar =
    tone === 'gilt' ? 'bg-gilt-400' : tone === 'emerald' ? 'bg-emerald-500' : 'bg-accent-500'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? '進度'}
        className="h-1 flex-1 overflow-hidden rounded-full bg-stage-750"
      >
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] text-ink-500">{pct}%</span>
    </div>
  )
}
