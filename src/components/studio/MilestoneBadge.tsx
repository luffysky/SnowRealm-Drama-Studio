'use client'

import { Check, Circle } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { milestoneReport } from '@/lib/milestones'
import type { Milestone } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * The `M1` / `M3` chips that mark unbuilt features, made answerable.
 *
 * They used to be labels you could only hover for a one-line tooltip, which
 * told you *that* something was unbuilt but never what else was in the same
 * batch, or how much of it was already done. Clicking one now opens the list.
 *
 * The list is mostly derived from the navigation tables rather than written
 * out, so a page that gets built drops off it on its own.
 */
export function MilestoneBadge({
  milestone,
  label,
  className,
}: {
  milestone: Milestone
  /** What is unbuilt, for the dialog's heading. */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          // The badge usually sits inside a disabled row or a link.
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
        title={`${milestone} 還有哪些沒做`}
        className={cn(
          'tap shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[10px] font-normal text-ink-600',
          'ring-1 ring-inset ring-stage-700 transition-colors',
          'hover:bg-stage-700 hover:text-ink-300',
          className
        )}
      >
        {milestone}
      </button>

      {open && (
        <MilestonePanel
          milestone={milestone}
          {...(label ? { label } : {})}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function MilestonePanel({
  milestone,
  label,
  onClose,
}: {
  milestone: Milestone
  label?: string
  onClose: () => void
}) {
  const report = milestoneReport(milestone)
  const total = report.done.length + report.todo.length
  const percent = total > 0 ? Math.round((report.done.length / total) * 100) : 0

  return (
    <Dialog
      open
      onRequestClose={onClose}
      title={`${milestone}　${report.summary}`}
      description={
        label
          ? `「${label}」屬於這個階段。以下是這個階段的全部項目。`
          : '以下是這個階段的全部項目。'
      }
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-[11px] text-ink-600">
            已完成 {report.done.length} / {total}（{percent}%）
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-ink-400 hover:bg-stage-800 hover:text-ink-100"
          >
            關閉
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${milestone} 完成度`}
          className="h-1.5 overflow-hidden rounded-full bg-stage-800"
        >
          <div className="bg-brand-gradient h-full" style={{ width: `${percent}%` }} />
        </div>

        {report.todo.length > 0 && (
          <Group title="還沒做" tone="todo" items={report.todo} />
        )}

        {report.done.length > 0 && (
          <Group title="已完成" tone="done" items={report.done} />
        )}

        {total === 0 && (
          <p className="py-6 text-center text-xs text-ink-600">
            這個階段沒有登記任何項目。
          </p>
        )}
      </div>
    </Dialog>
  )
}

function Group({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'todo' | 'done'
  items: { label: string; where: string }[]
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-medium text-ink-300">
        {title}
        <span className="ml-1.5 font-normal text-ink-600">{items.length}</span>
      </h3>

      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li
            key={`${item.label}-${item.where}`}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-stage-800/60"
          >
            {tone === 'done' ? (
              <Check aria-hidden className="mt-px size-3 shrink-0 text-emerald-400" />
            ) : (
              <Circle aria-hidden className="mt-px size-3 shrink-0 text-ink-700" />
            )}
            <span className={cn('min-w-0 flex-1', tone === 'done' ? 'text-ink-400' : 'text-ink-200')}>
              {item.label}
            </span>
            <span className="shrink-0 text-[10px] text-ink-600">{item.where}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
