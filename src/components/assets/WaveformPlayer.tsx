'use client'

import {
  Loader2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { assetUrl } from '@/lib/asset-url'
import type { WaveformData } from '@/lib/audio-waveform'
import { cn, formatDurationZh } from '@/lib/utils'

/**
 * 83 音訊播放與波形 (Z7).
 *
 * The peaks come from the `WAVEFORM` variant computed at upload time, so the
 * page can draw a waveform without downloading and decoding the audio.
 *
 * **With no peaks this renders the browser's own `<audio controls>` and says
 * why.** The spec calls that out, and it is the whole point: a waveform is a
 * map of where things happen in the track. Drawing a plausible one for a file
 * we never decoded would invite someone to scrub to a peak that is not there,
 * and nothing on screen would tell them the picture was invented.
 */

type LoadState = 'loading' | 'ready' | 'absent'

export function WaveformPlayer({
  assetId,
  durationSec,
  mimeType,
}: {
  assetId: string
  /** From the database. The audio element's own duration wins once known. */
  durationSec: number | null
  mimeType: string
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(durationSec ?? 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [looping, setLooping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ---------------------------------------------------------------- peaks */

  useEffect(() => {
    let cancelled = false

    fetch(`/api/files/${assetId}/waveform`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: WaveformData | null) => {
        if (cancelled) return
        // Guard the shape: a truncated or half-written peaks file would
        // otherwise draw as a flat line, which reads as silence.
        if (data && Array.isArray(data.peaks) && data.peaks.length > 0) {
          setWaveform(data)
          setState('ready')
        } else {
          setState('absent')
        }
      })
      .catch(() => {
        if (!cancelled) setState('absent')
      })

    return () => {
      cancelled = true
    }
  }, [assetId])

  /* ---------------------------------------------------------------- audio */

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setCurrent(audio.currentTime)
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration)
    }
    const onEnd = () => setPlaying(false)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onError = () => setError('這個檔案瀏覽器播不了，可以下載後用本機播放器開。')

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnd)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnd)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = muted ? 0 : volume
  }, [volume, muted])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.loop = looping
  }, [looping])

  /* ----------------------------------------------------------------- draw */

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return

    const context = canvas.getContext('2d')
    if (!context) return

    /*
     * Size the backing store to the device pixel ratio on every draw rather
     * than once: the sidebar collapsing, the window moving to another monitor
     * and a phone rotating each change one of these without remounting.
     */
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return

    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio)
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio)

    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)

    const peaks = waveform.peaks
    const barWidth = 2
    const gap = 1
    const columns = Math.max(1, Math.floor(width / (barWidth + gap)))
    const played = duration > 0 ? current / duration : 0
    const middle = height / 2

    for (let column = 0; column < columns; column += 1) {
      // Each column covers a span of peaks; take the span's maximum, so a
      // transient never vanishes between two columns.
      const from = Math.floor((column / columns) * peaks.length)
      const to = Math.max(from + 1, Math.floor(((column + 1) / columns) * peaks.length))

      let peak = 0
      for (let i = from; i < to; i += 1) {
        const value = peaks[i] ?? 0
        if (value > peak) peak = value
      }

      // A floor of one pixel: a silent passage should read as a thin line
      // through the middle, not as a gap that looks like missing data.
      const barHeight = Math.max(1, peak * (height - 2))
      const x = column * (barWidth + gap)

      context.fillStyle = column / columns <= played ? 'rgb(167 139 250)' : 'rgb(76 54 128)'
      context.fillRect(x, middle - barHeight / 2, barWidth, barHeight)
    }
  }, [waveform, current, duration])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [draw])

  /* ------------------------------------------------------------- controls */

  const seekTo = useCallback(
    (seconds: number) => {
      const audio = audioRef.current
      if (!audio || duration <= 0) return
      const clamped = Math.min(Math.max(seconds, 0), duration)
      audio.currentTime = clamped
      setCurrent(clamped)
    },
    [duration]
  )

  const seekFromPointer = useCallback(
    (clientX: number, element: HTMLElement) => {
      const box = element.getBoundingClientRect()
      if (box.width <= 0) return
      seekTo(((clientX - box.left) / box.width) * duration)
    },
    [duration, seekTo]
  )

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => setError('播放被瀏覽器擋下了，再按一次試試。'))
    } else {
      audio.pause()
    }
  }, [])

  const progress = duration > 0 ? current / duration : 0

  /* --------------------------------------------------------------- render */

  return (
    <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700 sm:p-4">
      {/*
        `preload="metadata"`, not `auto`: the duration and seekability are
        wanted immediately, the bytes are not.
      */}
      <audio ref={audioRef} src={assetUrl(assetId)} preload="metadata" className="hidden">
        <track kind="captions" />
      </audio>

      {state === 'loading' && (
        <div className="flex h-24 items-center justify-center gap-2 text-[11px] text-ink-600">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          讀取波形⋯
        </div>
      )}

      {state === 'absent' && (
        <div className="flex flex-col gap-2 rounded-lg bg-stage-950/60 p-3 ring-1 ring-stage-800">
          <p className="text-[11px] text-ink-400">
            這個檔案沒有波形資料，改用瀏覽器內建播放器。
          </p>
          <p className="text-[10px] leading-relaxed text-ink-600">
            波形是上傳時在瀏覽器裡算好存起來的。這首可能是在那之前上傳的，
            或是瀏覽器解不開它的編碼。重新上傳一次就會有。
          </p>
          <audio src={assetUrl(assetId)} controls preload="metadata" className="mt-1 w-full">
            <track kind="captions" />
          </audio>
        </div>
      )}

      {state === 'ready' && (
        <>
          <div className="flex items-baseline justify-between text-[10px] text-ink-600 tabular-nums">
            <span>{formatDurationZh(Math.floor(current))}</span>
            <span className="text-ink-700">{mimeType || '音訊'}</span>
            <span>{duration > 0 ? formatDurationZh(Math.floor(duration)) : '—'}</span>
          </div>

          {/*
            The canvas is the scrub target. A button wrapper would be the
            obvious accessible choice but cannot carry a position this fine,
            so the keyboard equivalent is the slider below — a real range
            input, not a styled div.
          */}
          <div
            className="relative h-24 cursor-pointer select-none sm:h-28"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              seekFromPointer(event.clientX, event.currentTarget)
            }}
            onPointerMove={(event) => {
              // Only while dragging: `buttons` is 0 for a plain hover.
              if (event.buttons === 1) seekFromPointer(event.clientX, event.currentTarget)
            }}
          >
            <canvas ref={canvasRef} className="size-full" />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-accent-300"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          <label className="sr-only" htmlFor={`seek-${assetId}`}>
            播放位置
          </label>
          <input
            id={`seek-${assetId}`}
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={current}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-stage-700 accent-accent-500"
          />

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            <IconButton label="倒退 10 秒" onClick={() => seekTo(current - 10)}>
              <RotateCcw aria-hidden className="size-4" />
            </IconButton>

            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? '暫停' : '播放'}
              className="bg-brand-gradient glow-accent-sm grid size-11 place-items-center rounded-full text-white transition-transform hover:scale-105"
            >
              {playing ? (
                <Pause aria-hidden className="size-5" />
              ) : (
                <Play aria-hidden className="size-5 translate-x-px" />
              )}
            </button>

            <IconButton label="快轉 10 秒" onClick={() => seekTo(current + 10)}>
              <RotateCw aria-hidden className="size-4" />
            </IconButton>

            <IconButton
              label={looping ? '關閉循環' : '循環播放'}
              active={looping}
              onClick={() => setLooping((on) => !on)}
            >
              <Repeat aria-hidden className="size-4" />
            </IconButton>

            <div className="flex items-center gap-1.5">
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
              <label className="sr-only" htmlFor={`volume-${assetId}`}>
                音量
              </label>
              <input
                id={`volume-${assetId}`}
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
        </>
      )}

      {error && (
        <p role="status" className="text-center text-[11px] text-amber-300">
          {error}
        </p>
      )}
    </section>
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
