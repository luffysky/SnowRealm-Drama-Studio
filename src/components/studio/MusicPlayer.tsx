'use client'

import {
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MUSIC_CATEGORY_LABEL } from '@/lib/music-view'
import { cn, formatDurationZh } from '@/lib/utils'
import { usePlayer, type PlayerTrack } from '@/components/studio/PlayerProvider'
import { TrackLyrics } from '@/components/studio/TrackLyrics'

/**
 * 音樂播放器 — every track in the studio, with a queue.
 *
 * Built as a jukebox rather than a list of `<audio controls>` tags, because
 * those cannot do the thing anyone actually wants here: play one track after
 * another. A page of forty native players is also forty independent volume
 * settings and forty ways to have two things playing at once.
 *
 * Shuffle keeps a fixed permutation rather than picking at random each time a
 * track ends: a true random walk repeats tracks and never finishes the list,
 * and 上一首 after a random jump has nowhere to go back to.
 */

/*
 * 型別搬到 `PlayerProvider` 了 (Z124)——播放狀態在那裡，型別跟著它走，
 * 兩份定義遲早會分岔。這裡重新匯出，呼叫端的 import 不用全部改。
 */
export type { PlayerTrack }

export function MusicPlayer({
  tracks,
  canEditLyrics = false,
}: {
  tracks: PlayerTrack[]
  /** Whether this member may write lyrics (Z125). */
  canEditLyrics?: boolean
}) {
  /*
   * 播放狀態不在這裡 (Z124)。
   *
   * It lives in `PlayerProvider`, mounted in the studio layout, because an
   * `<audio>` element owned by a page stops the moment you navigate — and
   * the thing people do while listening is navigate. This component is the
   * full-size view onto that: the queue, the list, the controls.
   */
  const player = usePlayer()

  const [filter, setFilter] = useState('')

  /*
   * Hand the library over. `load` keeps the queue — and whatever is playing —
   * when the same list arrives again, so coming back to this page does not
   * restart the song.
   */
  useEffect(() => {
    player.load(tracks)
  }, [tracks, player])

  const {
    index,
    playing,
    current,
    duration,
    volume,
    muted,
    repeat,
    shuffle,
    error,
    track,
    toggle,
    step,
    seek,
    setVolume,
    setMuted,
    setRepeat,
  } = player

  const setIndex = player.playAt
  const toggleShuffle = () => player.setShuffle(!shuffle)


  const seekTo = useCallback(
    (seconds: number) => {
      if (duration <= 0) return
      seek(Math.min(Math.max(seconds, 0), duration))
    },
    [duration, seek]
  )

  /* --------------------------------------------------------------- queue */

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return tracks.map((item, i) => ({ item, i }))

    return tracks
      .map((item, i) => ({ item, i }))
      .filter(
        ({ item }) =>
          item.title.toLowerCase().includes(term) ||
          item.name.toLowerCase().includes(term) ||
          item.artist.toLowerCase().includes(term) ||
          item.projectTitle.toLowerCase().includes(term)
      )
  }, [tracks, filter])

  if (!track) return null

  const progress = duration > 0 ? current / duration : 0

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      {/* The audio element is in `PlayerProvider`, above every page (Z124). */}

      {/*
        ---- now playing ----

        `min-w-0` is load-bearing. Below `xl` the grid has no explicit columns,
        so its single auto column is sized to the content's **max-content**
        width — and 「大明不妙曲--此去半生戴上耳機聽歌」 is wider than a phone.
        The `truncate` on the title cannot help: a flex child only shrinks
        below its content when every grid and flex ancestor allows it to, and
        the grid item itself was not. Measured 10px of horizontal page scroll
        at 390px before this.
      */}
      <section className="panel flex min-w-0 flex-col gap-4 rounded-xl bg-stage-900 p-5 ring-1 ring-stage-700">
        <div className="flex items-center gap-4">
          <span className="bg-brand-gradient glow-accent-sm grid size-20 shrink-0 place-items-center rounded-xl">
            <Music aria-hidden className="size-8 text-white/90" />
          </span>

          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-base font-semibold text-ink-50">
              {track.title || track.name}
            </p>
            <p className="truncate text-[11px] text-ink-400">
              {track.artist || '未註明演出'}
              {' ・ '}
              {MUSIC_CATEGORY_LABEL[track.category] ?? track.category}
            </p>
            <Link
              href={`/projects/${track.projectId}/assets/music/${track.assetId}`}
              className="tap truncate text-[10px] text-ink-600 underline-offset-2 transition-colors hover:text-accent-300 hover:underline"
            >
              {track.projectTitle}・看波形與資訊
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="relative h-1.5">
            <div className="absolute inset-0 rounded-full bg-stage-800" />
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-full bg-accent-500"
              style={{ width: `${progress * 100}%` }}
            />
            <label className="sr-only" htmlFor="music-seek">
              播放位置
            </label>
            <input
              id="music-seek"
              type="range"
              min={0}
              max={Math.max(duration, 0.01)}
              step={0.01}
              value={current}
              onChange={(event) => seekTo(Number(event.target.value))}
              /* `-inset-y-3` so the thumb is draggable on a phone; the
                 bar itself is 6px tall and a finger is not. */
              className="absolute inset-x-0 -inset-y-3 w-full cursor-pointer opacity-0"
            />
          </div>
          <div className="flex justify-between text-[10px] text-ink-600 tabular-nums">
            <span>{formatDurationZh(Math.floor(current))}</span>
            <span>{formatDurationZh(Math.floor(duration))}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <IconButton
            label={shuffle ? '關閉隨機' : '隨機播放'}
            active={shuffle}
            onClick={toggleShuffle}
          >
            <Shuffle aria-hidden className="size-4" />
          </IconButton>

          <IconButton label="上一首" onClick={() => step(-1)}>
            <SkipBack aria-hidden className="size-4" />
          </IconButton>

          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? '暫停' : '播放'}
            className="bg-brand-gradient glow-accent-sm grid size-12 place-items-center rounded-full text-white transition-transform hover:scale-105"
          >
            {playing ? (
              <Pause aria-hidden className="size-5" />
            ) : (
              <Play aria-hidden className="size-5 translate-x-0.5" />
            )}
          </button>

          <IconButton label="下一首" onClick={() => step(1)}>
            <SkipForward aria-hidden className="size-4" />
          </IconButton>

          <IconButton
            label={
              repeat === 'off' ? '循環全部' : repeat === 'all' ? '單曲循環' : '關閉循環'
            }
            active={repeat !== 'off'}
            onClick={() =>
              setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')
            }
          >
            {repeat === 'one' ? (
              <Repeat1 aria-hidden className="size-4" />
            ) : (
              <Repeat aria-hidden className="size-4" />
            )}
          </IconButton>

          <div className="flex items-center gap-1.5">
            <IconButton
              label={muted ? '取消靜音' : '靜音'}
              active={muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? (
                <VolumeX aria-hidden className="size-4" />
              ) : (
                <Volume2 aria-hidden className="size-4" />
              )}
            </IconButton>
            <label className="sr-only" htmlFor="music-volume">
              音量
            </label>
            <input
              id="music-volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => {
                setVolume(Number(event.target.value))
                setMuted(false)
              }}
              className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-stage-700 accent-accent-500"
            />
          </div>
        </div>

        {error && (
          <p role="status" className="text-center text-[11px] text-amber-300">
            {error}
          </p>
        )}

        {/*
          歌詞 (Z125). Under the transport on purpose: it is the thing you
          read while the controls are the thing you reach for, and putting it
          in the right-hand column would have it fighting the queue for the
          one place a phone has.
        */}
        <TrackLyrics canEdit={canEditLyrics} />
      </section>

      {/* ---- queue ------------------------------------------------------ */}
      <section className="panel flex max-h-[32rem] min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
        <header className="flex flex-col gap-2 border-b border-stage-700/60 p-3">
          <div className="flex items-center gap-1.5">
            <ListMusic aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="text-xs font-medium text-ink-200">播放清單</h3>
            <span className="ml-auto text-[10px] text-ink-600">{tracks.length} 首</span>
          </div>

          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
            />
            <label className="sr-only" htmlFor="music-filter">
              搜尋曲目
            </label>
            <input
              id="music-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜尋曲名、演出或作品"
              className="h-8 w-full rounded-lg bg-stage-850 pr-2 pl-8 text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          </div>
        </header>

        <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {visible.length === 0 ? (
            <li className="px-2 py-6 text-center text-[11px] text-ink-600">沒有符合的曲目</li>
          ) : (
            visible.map(({ item, i }) => (
              <li key={item.assetId}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                    i === index
                      ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40'
                      : 'hover:bg-stage-800'
                  )}
                >
                  <span className="w-5 shrink-0 text-center text-[10px] text-ink-600 tabular-nums">
                    {i === index && playing ? (
                      <Volume2 aria-hidden className="mx-auto size-3 text-accent-400" />
                    ) : (
                      i + 1
                    )}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        'truncate text-[11px]',
                        i === index ? 'font-medium text-ink-50' : 'text-ink-200'
                      )}
                    >
                      {item.title || item.name}
                    </span>
                    <span className="truncate text-[10px] text-ink-600">
                      {item.artist || item.projectTitle}
                    </span>
                  </span>

                  <span className="shrink-0 text-[10px] text-ink-600 tabular-nums">
                    {item.durationSec !== null ? formatDurationZh(item.durationSec) : '—'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ol>
      </section>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'grid size-8 place-items-center rounded-lg transition-colors',
        active
          ? 'bg-accent-600/25 text-accent-300 ring-1 ring-accent-500/40'
          : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}

