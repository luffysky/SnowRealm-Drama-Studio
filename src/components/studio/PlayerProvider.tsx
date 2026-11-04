'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { assetUrl } from '@/lib/asset-url'

/**
 * 播放不隨著換頁停掉 (Z124).
 *
 * The player used to own its own `<audio>` element, which meant the element
 * was unmounted the moment you navigated — so opening the episode you were
 * scoring stopped the music you were scoring it to. The fix is not a bigger
 * player; it is putting the element somewhere that does not unmount.
 *
 * So the element and the whole of playback live here, in the studio layout,
 * and every player on every page is a view onto this. One element also means
 * one volume and one thing playing: a page of forty native `<audio controls>`
 * is forty volumes and forty ways to have two songs at once.
 *
 * Deliberately **not** persisted across a reload. A page that starts playing
 * music by itself because you reloaded it is worse than one that forgets.
 */

export type PlayerTrack = {
  assetId: string
  projectId: string
  projectTitle: string
  title: string
  name: string
  artist: string
  category: string
  durationSec: number | null
  licenseStatus: string
}

export type RepeatMode = 'off' | 'all' | 'one'

type PlayerState = {
  queue: PlayerTrack[]
  index: number
  track: PlayerTrack | null
  playing: boolean
  current: number
  duration: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  error: string | null
}

type PlayerApi = PlayerState & {
  /** Replaces the queue. Keeps playing if the current track is still in it. */
  load: (tracks: PlayerTrack[]) => void
  playAt: (index: number) => void
  toggle: () => void
  step: (delta: number) => void
  seek: (seconds: number) => void
  setVolume: (value: number) => void
  setMuted: (value: boolean) => void
  setRepeat: (value: RepeatMode) => void
  setShuffle: (value: boolean) => void
  stop: () => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

export function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext)
  if (!api) throw new Error('usePlayer 必須在 PlayerProvider 底下使用')
  return api
}

/** Same hook, but tolerant — for widgets that may render outside the studio. */
export function useOptionalPlayer(): PlayerApi | null {
  return useContext(PlayerContext)
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [queue, setQueue] = useState<PlayerTrack[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [shuffle, setShuffle] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * A fixed permutation, not a fresh pick each time a track ends.
   *
   * A true random walk repeats tracks and never finishes the list, and
   * 「上一首」 after a random jump has nowhere to go back to.
   */
  const [order, setOrder] = useState<number[]>([])

  const track = queue[index] ?? null

  /** Where the current track sits in the play order. */
  const orderPosition = useMemo(() => {
    const at = order.indexOf(index)
    return at === -1 ? 0 : at
  }, [order, index])

  const step = useCallback(
    (delta: number) => {
      if (order.length === 0) return

      const next = orderPosition + delta
      if (next < 0 || next >= order.length) {
        if (repeat !== 'all') {
          setPlaying(false)
          return
        }
        setIndex(order[(next + order.length) % order.length] ?? 0)
        return
      }
      setIndex(order[next] ?? 0)
    },
    [order, orderPosition, repeat]
  )

  /* ---------------------------------------------------------------- audio */

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setCurrent(audio.currentTime)
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onError = () => setError('這個檔案瀏覽器播不了。')

    /*
     * A new src resets the readout here rather than in an effect on the track
     * id: the element is the thing that knows a different file started, and
     * `playing` carries over so picking the next track does not stop the
     * music the way a bare src swap does.
     */
    const onLoadStart = () => {
      setCurrent(0)
      setError(null)
      if (playing) void audio.play().catch(() => setPlaying(false))
    }

    const onEnded = () => {
      if (repeat === 'one') {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        return
      }
      step(1)
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('loadstart', onLoadStart)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('loadstart', onLoadStart)
    }
  }, [repeat, step, playing])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = muted ? 0 : volume
  }, [volume, muted])

  /* ----------------------------------------------------------------- api */

  const load = useCallback(
    (tracks: PlayerTrack[]) => {
      setQueue((previous) => {
        /*
         * Keep playing across a navigation that hands over the same library.
         * Reloading the queue every time a page mounts would restart the song
         * you were already listening to, which is the bug this file exists
         * to fix wearing a different hat.
         */
        const sameLength = previous.length === tracks.length
        const sameIds =
          sameLength && previous.every((row, i) => row.assetId === tracks[i]?.assetId)
        return sameIds ? previous : tracks
      })

      setOrder((previous) =>
        previous.length === tracks.length ? previous : tracks.map((_, i) => i)
      )
    },
    []
  )

  const playAt = useCallback((next: number) => {
    setIndex(next)
    setPlaying(true)
    // The element may already hold this src; `loadstart` will not fire again.
    window.setTimeout(() => void audioRef.current?.play().catch(() => {}), 0)
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => setError('播放被瀏覽器擋下了，再按一次。'))
    } else {
      audio.pause()
    }
  }, [])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = seconds
  }, [])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    setPlaying(false)
  }, [])

  const applyShuffle = useCallback(
    (on: boolean) => {
      setShuffle(on)
      setOrder(() => {
        const base = queue.map((_, i) => i)
        if (!on) return base

        // Fisher–Yates, with the current track first so it is not cut off.
        const rest = base.filter((i) => i !== index)
        for (let i = rest.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
        }
        return [index, ...rest]
      })
    },
    [queue, index]
  )

  const api = useMemo<PlayerApi>(
    () => ({
      queue,
      index,
      track,
      playing,
      current,
      duration,
      volume,
      muted,
      repeat,
      shuffle,
      error,
      load,
      playAt,
      toggle,
      step,
      seek,
      setVolume: setVolumeState,
      setMuted,
      setRepeat,
      setShuffle: applyShuffle,
      stop,
    }),
    [
      queue, index, track, playing, current, duration, volume, muted, repeat,
      shuffle, error, load, playAt, toggle, step, seek, applyShuffle, stop,
    ]
  )

  return (
    <PlayerContext.Provider value={api}>
      {/*
        The one audio element, mounted above every page so navigation does
        not stop it. `preload="metadata"` because a library of forty tracks
        should not download forty files to show their lengths.
      */}
      <audio
        ref={audioRef}
        src={track ? assetUrl(track.assetId) : undefined}
        preload="metadata"
      />
      {children}
    </PlayerContext.Provider>
  )
}
