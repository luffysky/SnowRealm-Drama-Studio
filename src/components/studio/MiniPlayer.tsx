'use client'

import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePlayer } from '@/components/studio/PlayerProvider'
import { cn } from '@/lib/utils'

/**
 * 換頁之後還看得到、還控制得到的那一條 (Z124).
 *
 * Playback surviving navigation is only half of it: music that keeps playing
 * with no way to pause it without finding the page it started on is worse
 * than music that stops. So once something is playing and you are somewhere
 * else, this appears.
 *
 * Hidden on the player's own page, where the real controls are — two sets of
 * transport buttons on one screen is a question about which one is real.
 */
export function MiniPlayer() {
  const player = usePlayer()
  const pathname = usePathname()

  const onPlayerPage = pathname.startsWith('/listen')
  if (!player.track || onPlayerPage) return null

  const { track } = player

  return (
    <div
      /*
       * Above the rail, below the chat ball, and clear of the home indicator.
       * Left-aligned on purpose: the ball lives bottom-right and the two must
       * not fight for the same corner.
       */
      style={{ bottom: 'calc(var(--dock-height, 0px) + var(--safe-bottom, 0px) + 0.5rem)' }}
      className="panel animate-rise fixed left-2 z-40 flex w-[min(22rem,calc(100vw-1rem))] items-center gap-2 rounded-xl bg-stage-850 p-2 ring-1 shadow-2xl ring-stage-700 lg:left-[16.5rem]"
    >
      <Link
        href={`/listen/${track.projectId}`}
        className="min-w-0 flex-1 leading-tight"
        title="回到音樂播放器"
      >
        <p className="truncate text-[11px] text-ink-100">{track.title || track.name}</p>
        <p className="truncate text-[10px] text-ink-600">
          {track.artist || track.projectTitle}
          <span className="ml-1.5 tabular-nums">
            {formatSeconds(player.current)}
            {player.duration > 0 && ` / ${formatSeconds(player.duration)}`}
          </span>
        </p>
      </Link>

      <div className="flex shrink-0 items-center gap-0.5">
        <Control label="上一首" onClick={() => player.step(-1)}>
          <SkipBack aria-hidden className="size-3.5" />
        </Control>

        <button
          type="button"
          onClick={player.toggle}
          aria-label={player.playing ? '暫停' : '播放'}
          className="tap grid size-8 place-items-center rounded-full bg-accent-600 text-white transition-colors hover:bg-accent-500"
        >
          {player.playing ? (
            <Pause aria-hidden className="size-3.5" />
          ) : (
            <Play aria-hidden className="size-3.5" />
          )}
        </button>

        <Control label="下一首" onClick={() => player.step(1)}>
          <SkipForward aria-hidden className="size-3.5" />
        </Control>

        <Control label="停止播放" onClick={player.stop}>
          <X aria-hidden className="size-3.5" />
        </Control>
      </div>
    </div>
  )
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'tap grid size-7 place-items-center rounded-full text-ink-500',
        'transition-colors hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}

/** mm:ss — `formatClock` is for times of day, not durations. */
function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return '0:00'
  const total = Math.max(0, Math.floor(value))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
