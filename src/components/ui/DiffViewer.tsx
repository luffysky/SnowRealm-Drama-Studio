'use client'

import { useMemo } from 'react'
import { diffLines, diffStats, type DiffOp } from '@/lib/diff'
import { cn } from '@/lib/utils'

/**
 * Renders a line diff. The algorithm itself lives in `@/lib/diff` so it can be
 * unit-tested without a JSX transform.
 */

export type { DiffOp }
export { diffLines, diffStats }

export type DiffViewerProps = {
  before: string
  after: string
  beforeLabel?: string
  afterLabel?: string
  /** 'unified' stacks changes inline; 'split' shows the two texts side by side. */
  mode?: 'unified' | 'split'
  className?: string
}

export function DiffViewer({
  before,
  after,
  beforeLabel = '原文',
  afterLabel = '候選',
  mode = 'unified',
  className,
}: DiffViewerProps) {
  const ops = useMemo(() => diffLines(before, after), [before, after])
  const stats = useMemo(() => diffStats(ops), [ops])

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-ink-500">
          {beforeLabel} → {afterLabel}
        </span>
        <span className="text-emerald-400">+{stats.added}</span>
        <span className="text-rose-400">−{stats.removed}</span>
      </div>

      {mode === 'split' ? (
        <SplitView before={before} after={after} />
      ) : (
        <div className="overflow-x-auto rounded-md bg-stage-950 ring-1 ring-stage-700">
          {/*
            Rows are divs inside a `whitespace-pre` container rather than
            children of a <pre>: <pre> only admits phrasing content, so a <div>
            inside one is invalid nesting — which React reports as a hydration
            mismatch.
          */}
          <div className="min-w-max font-mono text-[11px] leading-relaxed whitespace-pre">
            {ops.map((op, index) => (
              <div
                key={index}
                className={cn(
                  'px-3 py-0.5',
                  op.type === 'add' && 'bg-emerald-950/60 text-emerald-200',
                  op.type === 'remove' && 'bg-rose-950/60 text-rose-200',
                  op.type === 'same' && 'text-ink-400'
                )}
              >
                <span aria-hidden className="mr-2 inline-block w-2 select-none text-ink-600">
                  {op.type === 'add' ? '+' : op.type === 'remove' ? '−' : ' '}
                </span>
                {op.text || ' '}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SplitView({ before, after }: { before: string; after: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[
        { text: before, tone: 'rose' as const },
        { text: after, tone: 'emerald' as const },
      ].map((side, index) => (
        <div
          key={index}
          className="overflow-x-auto rounded-md bg-stage-950 ring-1 ring-stage-700"
        >
          <pre
            className={cn(
              'min-w-max p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap',
              side.tone === 'rose' ? 'text-ink-400' : 'text-ink-200'
            )}
          >
            {side.text || '（空）'}
          </pre>
        </div>
      ))}
    </div>
  )
}
