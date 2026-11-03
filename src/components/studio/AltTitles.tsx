'use client'

import { dramaTitleOf, novelTitleOf, type ProjectTitles } from '@/lib/project-titles'
import { cn } from '@/lib/utils'

/**
 * 小說書名 / 短劇劇名, wherever a project is named.
 *
 * One production can carry three names, and a name set in 作品設定 that then
 * appears nowhere is indistinguishable from one that was never saved — which
 * is exactly how it was reported. So every surface that names a project shows
 * the alternates through this, rather than each deciding for itself.
 *
 * Renders nothing when all three names match: printing the same name three
 * times is noise, not information.
 */
export function AltTitles({
  project,
  className,
  compact = false,
}: {
  project: ProjectTitles
  className?: string
  /** One line with separators, for a dense card. */
  compact?: boolean
}) {
  const novel = novelTitleOf(project)
  const drama = dramaTitleOf(project)

  const parts: { label: string; value: string }[] = []
  if (novel !== project.title) parts.push({ label: '小說', value: novel })
  if (drama !== project.title) parts.push({ label: '短劇', value: drama })

  if (parts.length === 0) return null

  if (compact) {
    return (
      <p className={cn('truncate text-[10px] text-ink-600', className)}>
        {parts.map((part) => `${part.label}《${part.value}》`).join('　')}
      </p>
    )
  }

  return (
    <dl
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-ink-500',
        className
      )}
    >
      {parts.map((part) => (
        <div key={part.label} className="flex min-w-0 gap-1">
          <dt className="shrink-0">{part.label}</dt>
          <dd className="min-w-0 truncate text-ink-300">{part.value}</dd>
        </div>
      ))}
    </dl>
  )
}
