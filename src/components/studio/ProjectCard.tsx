'use client'

import { CalendarDays, Crown, Heart, PlayCircle, Coins, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  type ProjectStatusValue,
} from '@/lib/constants'
import { formatFromBase, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'
import { assetPreviewUrl } from '@/lib/asset-url'

/**
 * One card in the 作品列表 grid (design 03).
 *
 * Numbers come from the server. Where a project has no data yet the card says
 * so plainly — a seeded project with no episodes shows 規劃中, not a fabricated
 * percentage (spec v2 §0).
 */

export type ProjectCardData = {
  id: string
  title: string
  status: ProjectStatusValue
  tags: string[]
  isFlagship: boolean
  episodeCount: number
  plannedEpisodes: number
  progress: number
  dueDate: string | null
  spend: number
  isFavourite: boolean
  /** Cover image, served through /api/files which checks the session first. */
  coverAssetId: string | null
}

export function ProjectCard({
  project,
  currency,
  fx,
  selected,
  onSelect,
}: {
  project: ProjectCardData
  currency: CurrencyValue
  fx: FxRates
  selected: boolean
  onSelect: (id: string) => void
}) {
  const toast = useToast()
  const [favourite, setFavourite] = useState(project.isFavourite)
  const [pending, setPending] = useState(false)

  const pct = Math.round(project.progress * 100)
  const complete = pct >= 100

  async function toggleFavourite(event: React.MouseEvent) {
    // The whole card is a selection target; the heart must not also select it.
    event.stopPropagation()
    if (pending) return

    const next = !favourite
    setFavourite(next) // optimistic
    setPending(true)

    try {
      const response = await apiFetch(`/api/projects/${project.id}/favourite`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { isFavourite: boolean }
      setFavourite(body.isFavourite)
    } catch (error) {
      setFavourite(!next) // roll back
      toast.error('收藏失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setPending(false)
    }
  }

  /** Episode range line. Falls back to the plan when nothing exists yet. */
  const episodeLine =
    project.episodeCount > 0
      ? `EP001 – EP${String(project.episodeCount).padStart(3, '0')}（共 ${project.episodeCount} 集）`
      : project.plannedEpisodes > 0
        ? `規劃中（預計 ${project.plannedEpisodes} 集）`
        : '尚未規劃集數'

  return (
    <button
      type="button"
      onClick={() => onSelect(project.id)}
      aria-pressed={selected}
      className={cn(
        'panel group flex flex-col overflow-hidden rounded-xl bg-stage-900 text-left ring-1 transition-all',
        selected
          ? 'glow-accent ring-accent-500/60'
          : 'ring-stage-700 hover:ring-stage-600'
      )}
    >
      {/* cover */}
      <div className="relative aspect-video w-full overflow-hidden">
        {/*
          The bucket is private, so the cover is fetched through
          /api/files/<id>, which checks the session and then redirects to a
          short-lived presigned URL. Embedding the presigned URL directly would
          rot as soon as it expired.

          Plain <img>, not next/image: the route answers with a 307 to R2, and
          the optimiser would have to be allow-listed for a host that changes.
        */}
        {project.coverAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetPreviewUrl(project.coverAssetId)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          /* Gradient stands in until a cover asset is uploaded. */
          <div aria-hidden className="art-placeholder absolute inset-0" />
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-stage-950 via-stage-950/40 to-transparent"
        />

        <span
          className={cn(
            'absolute top-2 left-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
            project.isFlagship
              ? 'bg-gilt-400/90 text-stage-950 ring-gilt-300'
              : PROJECT_STATUS_STYLE[project.status]
          )}
        >
          {project.isFlagship && <Crown aria-hidden className="size-3" />}
          {project.isFlagship ? '主力作品' : PROJECT_STATUS_LABEL[project.status]}
        </span>

        <span
          role="button"
          tabIndex={0}
          aria-label={favourite ? '取消收藏' : '收藏'}
          aria-pressed={favourite}
          onClick={toggleFavourite}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              void toggleFavourite(e as unknown as React.MouseEvent)
            }
          }}
          className={cn(
            'absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-full backdrop-blur transition-colors',
            favourite
              ? 'bg-rose-500/25 text-rose-300'
              : 'bg-stage-950/50 text-ink-400 hover:text-ink-100'
          )}
        >
          <Heart aria-hidden className={cn('size-3.5', favourite && 'fill-current')} />
        </span>

        <h3 className="absolute right-3 bottom-2 left-3 truncate text-base font-semibold text-ink-50">
          {project.title}
        </h3>
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-stage-800 px-1.5 py-0.5 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-400">{episodeLine}</span>
          <span
            aria-hidden
            title="更多操作尚未實作，預計於 M1 階段交付"
            className="shrink-0 cursor-default text-ink-700"
          >
            <MoreHorizontal className="size-4" />
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${project.title} 製作進度`}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                complete ? 'bg-emerald-500' : pct > 0 ? 'bg-brand-gradient' : ''
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="w-9 shrink-0 text-right text-[11px] font-medium text-ink-200">
            {pct}%
          </span>
        </div>

        <div className="flex items-center gap-3 border-t border-stage-700/60 pt-2 text-[10px] text-ink-500">
          <span className="inline-flex items-center gap-1">
            <PlayCircle aria-hidden className="size-3" />
            {project.episodeCount || project.plannedEpisodes} 集
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays aria-hidden className="size-3" />
            {project.dueDate
              ? new Date(project.dueDate).toLocaleDateString('zh-TW')
              : '未定'}
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Coins aria-hidden className="size-3" />
            {project.spend > 0 ? formatFromBase(project.spend, currency, fx) : '—'}
          </span>
        </div>
      </div>
    </button>
  )
}
