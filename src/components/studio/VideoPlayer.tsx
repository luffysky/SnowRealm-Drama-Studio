'use client'

import {
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { assetPreviewUrl, assetUrl } from '@/lib/asset-url'
import { cn, formatDurationZh } from '@/lib/utils'

/**
 * 短劇播放器.
 *
 * A custom control bar rather than `controls`, because the native one has no
 * idea this is episode 7 of 120: it cannot skip to the next episode, and the
 * keyboard bindings people expect from a video site (space, arrows, F, M) are
 * inconsistent between browsers and absent on some.
 *
 * Playback rate is here because this is a working player as much as a viewing
 * one — reviewing a cut at 1.5× is how most of a 120-episode pass gets done.
 */

export type PlayerEpisode = {
  episodeId: string
  number: number
  title: string
  assetId: string
  durationSec: number | null
  hasPoster: boolean
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function VideoPlayer({
  episodes,
  index,
  onIndexChange,
}: {
  episodes: PlayerEpisode[]
  index: number
  onIndexChange: (index: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const episode = episodes[index]

  /* --------------------------------------------------------------- events */

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTime = () => {
      setCurrent(video.currentTime)
      // The last buffered range is the one around the playhead after a seek;
      // the first would show a bar left over from before.
      const ranges = video.buffered
      setBuffered(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0)
    }
    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onError = () => setError('這個檔案瀏覽器播不了，可以下載後用本機播放器開。')
    /*
     * A new episode is a new file. Resetting from the element's own
     * `loadstart` rather than from an effect on the asset id keeps the old
     * duration and error from describing the new one, and keeps the reset
     * where the browser actually changed files.
     */
    const onLoadStart = () => {
      setCurrent(0)
      setBuffered(0)
      setError(null)
    }
    const onEnded = () => {
      // Roll into the next episode, which is what a 120-episode drama is for.
      if (index < episodes.length - 1) onIndexChange(index + 1)
    }

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('error', onError)
    video.addEventListener('ended', onEnded)
    video.addEventListener('loadstart', onLoadStart)

    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('error', onError)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('loadstart', onLoadStart)
    }
  }, [index, episodes.length, onIndexChange])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = muted ? 0 : volume
  }, [volume, muted])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = rate
  }, [rate, index])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])


  /* ------------------------------------------------------------- controls */

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setError('播放被瀏覽器擋下了，再按一次試試。'))
    else video.pause()
  }, [])

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current
      if (!video || duration <= 0) return
      video.currentTime = Math.min(Math.max(seconds, 0), duration)
      setCurrent(video.currentTime)
    },
    [duration]
  )

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void shellRef.current?.requestFullscreen().catch(() => {})
  }, [])

  const pip = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
    else void video.requestPictureInPicture?.().catch(() => {})
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          toggle()
          break
        case 'ArrowRight':
          seekTo(current + 5)
          break
        case 'ArrowLeft':
          seekTo(current - 5)
          break
        case 'ArrowUp':
          event.preventDefault()
          setVolume((v) => Math.min(1, v + 0.1))
          break
        case 'ArrowDown':
          event.preventDefault()
          setVolume((v) => Math.max(0, v - 0.1))
          break
        case 'f':
          toggleFullscreen()
          break
        case 'm':
          setMuted((on) => !on)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seekTo, toggleFullscreen, current])

  if (!episode) return null

  const progress = duration > 0 ? current / duration : 0
  const bufferedPct = duration > 0 ? Math.min(1, buffered / duration) : 0

  return (
    <div
      ref={shellRef}
      className="panel flex flex-col overflow-hidden rounded-xl bg-stage-950 ring-1 ring-stage-700"
    >
      <div className="relative bg-black">
        { }
        <video
          ref={videoRef}
          key={episode.assetId}
          src={assetUrl(episode.assetId)}
          poster={episode.hasPoster ? assetPreviewUrl(episode.assetId) : undefined}
          preload="metadata"
          playsInline
          onClick={toggle}
          className="aspect-video w-full cursor-pointer bg-black"
        />

        {!playing && (
          <button
            type="button"
            onClick={toggle}
            aria-label="播放"
            className="absolute inset-0 grid place-items-center bg-black/20 transition-colors hover:bg-black/30"
          >
            <span className="bg-brand-gradient glow-accent-sm grid size-16 place-items-center rounded-full text-white">
              <Play aria-hidden className="size-7 translate-x-0.5" />
            </span>
          </button>
        )}
      </div>

      {/* ---- scrubber --------------------------------------------------- */}
      <div className="flex flex-col gap-2 p-3">
        <div className="relative h-1.5">
          {/* Buffered behind the playhead, so a stall reads as loading. */}
          <div className="absolute inset-0 rounded-full bg-stage-800" />
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-stage-600"
            style={{ width: `${bufferedPct * 100}%` }}
          />
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-accent-500"
            style={{ width: `${progress * 100}%` }}
          />
          <label className="sr-only" htmlFor="video-seek">
            播放位置
          </label>
          <input
            id="video-seek"
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={current}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            label="上一集"
            disabled={index === 0}
            onClick={() => onIndexChange(index - 1)}
          >
            <SkipBack aria-hidden className="size-4" />
          </IconButton>

          <IconButton label="倒退 10 秒" onClick={() => seekTo(current - 10)}>
            <RotateCcw aria-hidden className="size-4" />
          </IconButton>

          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? '暫停' : '播放'}
            className="bg-brand-gradient glow-accent-sm grid size-9 place-items-center rounded-full text-white"
          >
            {playing ? (
              <Pause aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4 translate-x-px" />
            )}
          </button>

          <IconButton label="快轉 10 秒" onClick={() => seekTo(current + 10)}>
            <RotateCw aria-hidden className="size-4" />
          </IconButton>

          <IconButton
            label="下一集"
            disabled={index >= episodes.length - 1}
            onClick={() => onIndexChange(index + 1)}
          >
            <SkipForward aria-hidden className="size-4" />
          </IconButton>

          <span className="ml-1 text-[11px] text-ink-400 tabular-nums">
            {formatDurationZh(Math.floor(current))} / {formatDurationZh(Math.floor(duration))}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <IconButton
              label={muted ? '取消靜音' : '靜音'}
              active={muted}
              onClick={() => setMuted((on) => !on)}
            >
              {muted ? (
                <VolumeX aria-hidden className="size-4" />
              ) : (
                <Volume2 aria-hidden className="size-4" />
              )}
            </IconButton>
            <label className="sr-only" htmlFor="video-volume">
              音量
            </label>
            <input
              id="video-volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => {
                setVolume(Number(event.target.value))
                setMuted(false)
              }}
              className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-stage-700 accent-accent-500"
            />

            <label className="sr-only" htmlFor="video-rate">
              播放速度
            </label>
            <div className="flex items-center gap-1">
              <Gauge aria-hidden className="size-3.5 text-ink-600" />
              <select
                id="video-rate"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
                className="rounded-md bg-stage-900 px-1.5 py-1 text-[11px] text-ink-300 ring-1 ring-stage-700 outline-none focus:ring-accent-500"
              >
                {RATES.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </div>

            <IconButton label="子母畫面" onClick={pip}>
              <PictureInPicture2 aria-hidden className="size-4" />
            </IconButton>

            <IconButton
              label={fullscreen ? '結束全螢幕' : '全螢幕'}
              onClick={toggleFullscreen}
            >
              {fullscreen ? (
                <Minimize aria-hidden className="size-4" />
              ) : (
                <Maximize aria-hidden className="size-4" />
              )}
            </IconButton>
          </div>
        </div>

        <p className="text-[10px] text-ink-700">
          空白鍵播放／暫停・←→ 快轉 5 秒・↑↓ 音量・F 全螢幕・M 靜音
        </p>

        {error && (
          <p role="status" className="text-[11px] text-amber-300">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'grid size-8 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        active
          ? 'bg-accent-600/25 text-accent-300 ring-1 ring-accent-500/40'
          : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}
