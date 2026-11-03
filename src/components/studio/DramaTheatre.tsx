'use client'

import { Check, ListVideo } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { VideoPlayer, type PlayerEpisode } from '@/components/studio/VideoPlayer'
import { assetPreviewUrl } from '@/lib/asset-url'
import { cn, formatDurationZh } from '@/lib/utils'

/**
 * One drama: the player and the episode list beside it.
 *
 * Which episode is open lives in the URL, so a link points at an episode and
 * the back button steps through what was watched. The player itself does not
 * know about routing — it is handed an index and reports when it wants
 * another, which is what lets autoplay roll into the next episode without the
 * player importing a router.
 */

export type TheatreEpisode = PlayerEpisode & {
  logline: string
}

export function DramaTheatre({ episodes }: { episodes: TheatreEpisode[] }) {
  const router = useRouter()
  const params = useSearchParams()

  const index = useMemo(() => {
    const wanted = params.get('ep')
    const found = episodes.findIndex((e) => e.episodeId === wanted)
    return found >= 0 ? found : 0
  }, [params, episodes])

  const setIndex = useCallback(
    (next: number) => {
      const episode = episodes[next]
      if (!episode) return

      const search = new URLSearchParams(params.toString())
      search.set('ep', episode.episodeId)
      // `scroll: false`: autoplay rolling into the next episode must not jump
      // the page to the top under someone reading the list.
      router.replace(`?${search.toString()}`, { scroll: false })
    },
    [episodes, params, router]
  )

  const current = episodes[index]

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-3">
        <VideoPlayer episodes={episodes} index={index} onIndexChange={setIndex} />

        {current && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-ink-50">
              EP{String(current.number).padStart(3, '0')}
              {current.title && <span className="ml-2">{current.title}</span>}
            </h3>
            {current.logline && (
              <p className="text-[11px] leading-relaxed text-ink-500">{current.logline}</p>
            )}
          </div>
        )}
      </div>

      <section className="panel flex max-h-[32rem] flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
        <header className="flex items-center gap-1.5 border-b border-stage-700/60 px-3 py-2.5">
          <ListVideo aria-hidden className="size-3.5 text-accent-400" />
          <h3 className="text-xs font-medium text-ink-200">選集</h3>
          <span className="ml-auto text-[10px] text-ink-600">{episodes.length} 集</span>
        </header>

        <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {episodes.map((episode, i) => (
            <li key={episode.episodeId}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors',
                  i === index
                    ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40'
                    : 'hover:bg-stage-800'
                )}
              >
                <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-stage-950">
                  {episode.hasPoster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPreviewUrl(episode.assetId)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span aria-hidden className="art-placeholder block size-full" />
                  )}
                  {episode.durationSec !== null && (
                    <span className="absolute right-0.5 bottom-0.5 rounded bg-stage-990/80 px-1 text-[9px] text-ink-300 tabular-nums">
                      {formatDurationZh(episode.durationSec)}
                    </span>
                  )}
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      'text-[11px] font-medium tabular-nums',
                      i === index ? 'text-ink-50' : 'text-ink-300'
                    )}
                  >
                    EP{String(episode.number).padStart(3, '0')}
                  </span>
                  <span className="truncate text-[10px] text-ink-600">
                    {episode.title || '未命名'}
                  </span>
                </span>

                {i === index && (
                  <Check aria-hidden className="size-3.5 shrink-0 text-accent-400" />
                )}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
