import { PlayCircle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EmptyState } from '@/components/ui/StateViews'
import { assetPreviewUrl } from '@/lib/asset-url'
import { getSessionUser } from '@/lib/auth/session'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE } from '@/lib/constants'
import { listDramas } from '@/lib/library'
import { dramaTitleOf } from '@/lib/project-titles'
import { cn, formatDurationZh } from '@/lib/utils'

export const metadata: Metadata = { title: '影片播放' }

/**
 * 短劇片單 — the works that have something to watch.
 *
 * A work appears only once at least one episode has a finished cut
 * (`episodes.final_asset_id`). Storyboard previews, clips and NG takes are all
 * VIDEO assets on an episode too, which is exactly why the finished cut is a
 * column of its own rather than "the newest video attached to this episode".
 */
export default async function WatchPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const dramas = await listDramas(user.id)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <PlayCircle aria-hidden className="size-4 text-accent-400" />
          片單
        </h2>
        <p className="text-[11px] text-ink-500">
          {dramas.length > 0 ? `${dramas.length} 部・點進去選集觀看` : '已定剪的成片會出現在這裡'}
        </p>
      </header>

      {dramas.length === 0 ? (
        <EmptyState
          title="還沒有可以看的成片"
          description="在集數的「成片」上傳定剪的影片，那一集就會出現在這裡。"
          icon={<PlayCircle aria-hidden className="size-5 text-ink-500" />}
          className="py-24"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dramas.map((drama) => (
            <li key={drama.projectId}>
              <Link
                href={`/watch/${drama.projectId}`}
                className="panel group flex h-full flex-col overflow-hidden rounded-xl bg-stage-900 ring-1 ring-stage-700 transition-all hover:ring-accent-500/50"
              >
                <div className="relative aspect-video overflow-hidden bg-stage-950">
                  {drama.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPreviewUrl(drama.coverAssetId)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span aria-hidden className="art-placeholder block size-full" />
                  )}

                  <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                    <PlayCircle aria-hidden className="size-10 text-white/90" />
                  </span>

                  <span
                    className={cn(
                      'absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] ring-1',
                      PROJECT_STATUS_STYLE[drama.status]
                    )}
                  >
                    {PROJECT_STATUS_LABEL[drama.status]}
                  </span>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                  <p className="truncate text-sm font-medium text-ink-50">
                    {dramaTitleOf(drama)}
                  </p>
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-500">
                    {drama.synopsis || '尚未撰寫簡介'}
                  </p>
                  <p className="mt-auto flex items-center gap-2 pt-1.5 text-[10px] text-ink-600">
                    <span className="tabular-nums">
                      已上片 {drama.releasedCount} / {drama.totalEpisodes} 集
                    </span>
                    {drama.totalSeconds > 0 && (
                      <>
                        <span>・</span>
                        <span className="tabular-nums">
                          共 {formatDurationZh(drama.totalSeconds)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
