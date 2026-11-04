'use client'

import { Loader2, Mic2, Pencil } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlayer } from '@/components/studio/PlayerProvider'
import { lineAt, parseLyrics } from '@/lib/lyrics'
import { cn } from '@/lib/utils'

/**
 * 播到哪，歌詞走到哪 (Z125).
 *
 * Three things make this read as a lyric sheet rather than a list of strings:
 *
 *  1. **The active line is centred, not just coloured.** Scrolled by the
 *     container, never by the page — `scrollIntoView` on a page would drag
 *     the whole studio around under somebody who is reading something else.
 *  2. **Clicking a line seeks to it.** It is the fastest way to replay the
 *     bar you could not make out, and it costs nothing once the timings exist.
 *  3. **Untimed lyrics say so.** Plain text is shown in full with a line
 *     explaining that it cannot follow along, rather than silently sitting
 *     still while the song plays — a feature that looks broken is worse than
 *     one that explains itself.
 *
 * Only follows the track it belongs to. The player is global (`Z124`), so
 * without that check this would highlight lines of 片頭曲 while 片尾曲 plays.
 */

export function LyricsPanel({
  assetId,
  lyrics,
  canEdit,
  onEdit,
}: {
  assetId: string
  lyrics: string
  canEdit: boolean
  onEdit?: () => void
}) {
  const player = usePlayer()
  const listRef = useRef<HTMLDivElement | null>(null)

  /** Parsed once per text, not on every `timeupdate`. */
  const parsed = useMemo(() => parseLyrics(lyrics), [lyrics])

  /** Is the thing playing actually this track? */
  const live = player.track?.assetId === assetId

  const active = live && parsed.timed ? lineAt(parsed.lines, player.current) : -1

  /*
   * Follows the song, but gets out of the way when somebody scrolls the sheet
   * themselves — otherwise reading ahead is impossible, every attempt is
   * yanked back within a second.
   */
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    if (!following || active < 0) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`)
    if (!node) return

    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, following])

  if (!lyrics.trim()) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-stage-900 px-4 py-8 text-center ring-1 ring-stage-700/60">
        <Mic2 aria-hidden className="size-5 text-ink-700" />
        <p className="text-[11px] text-ink-600">這首還沒有歌詞。</p>
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="tap inline-flex items-center gap-1 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100"
          >
            <Pencil aria-hidden className="size-3" />
            貼上或上傳歌詞
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-medium text-ink-300">歌詞</h3>

        {parsed.timed ? (
          live ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-accent-300">
              <Loader2
                aria-hidden
                className={cn('size-3', player.playing && 'animate-spin')}
              />
              跟著播放走
            </span>
          ) : (
            <span className="text-[10px] text-ink-700">播放這首就會跟著走</span>
          )
        ) : (
          <span className="text-[10px] text-ink-600">
            這份歌詞沒有時間碼，所以不會跟著走
          </span>
        )}

        {!following && (
          <button
            type="button"
            onClick={() => setFollowing(true)}
            className="tap ml-auto rounded-full bg-accent-600 px-2 py-0.5 text-[10px] text-white"
          >
            回到正在唱的那句
          </button>
        )}

        {canEdit && onEdit && following && (
          <button
            type="button"
            onClick={onEdit}
            className="tap ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            <Pencil aria-hidden className="size-3" />
            編輯
          </button>
        )}
      </div>

      <div
        ref={listRef}
        onWheel={() => setFollowing(false)}
        onTouchMove={() => setFollowing(false)}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700/60"
      >
        <ol className="flex flex-col gap-1">
          {parsed.lines.map((line, index) => {
            const isActive = index === active
            const seekable = parsed.timed && line.timeMs !== null

            return (
              <li key={`${index}-${line.timeMs ?? 'x'}`} data-line={index}>
                <button
                  type="button"
                  disabled={!seekable}
                  onClick={() => {
                    if (line.timeMs === null) return
                    player.seek(line.timeMs / 1000)
                    setFollowing(true)
                  }}
                  className={cn(
                    'w-full rounded px-2 py-1 text-left text-[12px] leading-relaxed transition-colors',
                    seekable && 'tap cursor-pointer hover:bg-stage-800',
                    isActive ? 'bg-accent-600/20 text-ink-50' : 'text-ink-400',
                    // An instrumental break: a timed line with no words.
                    line.text === '' && 'py-2 text-ink-700'
                  )}
                >
                  {line.text || (seekable ? '⋯' : '')}
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
