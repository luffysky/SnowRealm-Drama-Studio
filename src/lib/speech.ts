'use client'

/**
 * 朗讀，用瀏覽器內建的語音合成。
 *
 * Web Speech rather than a cloud TTS service, because a chapter is 7,000
 * characters and a novel is a hundred of them — paying per character to read
 * a book aloud costs more than the book took to write. This runs locally, for
 * nothing, with no upload and no wait.
 *
 * The tradeoff is that the voices are whatever the operating system ships.
 * Windows and macOS both include Chinese voices; a bare Linux install may
 * have none, which is why the reader checks before offering the control.
 *
 * **The hard part is not speaking. It is noticing that it stopped.**
 * `speechSynthesis` is a global queue in the browser with a long history of
 * dropping its own `end` event — through garbage collection, through
 * `pause()`/`resume()` on some platforms' local voices, through its fifteen
 * second cut-off. Every one of those looks identical from here: the chain is
 * waiting for an event that will never arrive, and the reading simply stops
 * mid-chapter with no error. So this does not try to enumerate the causes.
 * It keeps a reference so nothing can be collected, it never pokes a queue
 * that is working, and it watches for silence and moves on.
 */

export type Voice = {
  id: string
  name: string
  lang: string
  local: boolean
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * The voices worth offering, Chinese first.
 *
 * `getVoices()` is famously empty on the first call in Chrome — the list
 * arrives asynchronously and only fires `voiceschanged` once. Callers go
 * through `loadVoices` rather than calling this directly.
 */
function readVoices(): Voice[] {
  if (!speechSupported()) return []

  return window.speechSynthesis
    .getVoices()
    .map((voice) => ({
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      local: voice.localService,
    }))
    .sort((a, b) => {
      // Chinese first, then everything else alphabetically. A reader of a
      // Chinese novel should not have to scroll past forty English voices.
      const aZh = a.lang.toLowerCase().startsWith('zh')
      const bZh = b.lang.toLowerCase().startsWith('zh')
      if (aZh !== bZh) return aZh ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** Resolves once the browser has actually populated the voice list. */
export function loadVoices(): Promise<Voice[]> {
  if (!speechSupported()) return Promise.resolve([])

  const immediate = readVoices()
  if (immediate.length > 0) return Promise.resolve(immediate)

  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(readVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)

    // Some browsers never fire it. Give up rather than hang the control.
    window.setTimeout(done, 1500)
  })
}

/* -------------------------------------------------------------------------- */
/* Splitting                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * 切段搬到 `speech-split.ts` 了 (Z129)。
 *
 * 這個檔案是 `'use client'`，伺服器端的有聲小說匯出載不進來；但切法一定要
 * 兩邊一樣，否則同一個角色在閱讀器與匯出檔裡會在不同地方開口。重新匯出，
 * 呼叫端的 import 一行都不用改。
 */
import type { SpeechChunk } from '@/lib/speech-split'

export { splitForSpeech } from '@/lib/speech-split'
export type { SpeechChunk }

/* -------------------------------------------------------------------------- */
/* Speaking                                                                    */
/* -------------------------------------------------------------------------- */

export type SpeakOptions = {
  voiceId?: string | undefined
  rate: number
  pitch: number
  volume: number
  /** The paragraph now being spoken. */
  onBoundary?: (paragraph: number) => void
  onEnd?: () => void
  onError?: () => void
}

export type SpeechHandle = {
  stop: () => void
  pause: () => void
  resume: () => void
}

/**
 * How long silence is allowed to last before it counts as a dropped event.
 *
 * Long enough that the gap between two utterances is never mistaken for a
 * stall — measured at around 100ms — and short enough that a reader notices
 * a hiccup rather than a stop.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

const SILENCE_MS = 2000
const WATCH_MS = 400

/**
 * Reads chunks aloud, in order, and keeps reading.
 *
 * Speaking is a single global queue in the browser, so starting a second one
 * without stopping the first produces both at once; `stop()` on the handle is
 * not optional.
 */
export function speak(chunks: SpeechChunk[], options: SpeakOptions): SpeechHandle {
  const idle: SpeechHandle = { stop: () => {}, pause: () => {}, resume: () => {} }
  if (!speechSupported() || chunks.length === 0) return idle

  const synth = window.speechSynthesis
  synth.cancel()

  const voices = synth.getVoices()
  const byId = new Map(voices.map((v) => [v.voiceURI, v]))
  const narrator = options.voiceId ? (byId.get(options.voiceId) ?? null) : null

  let index = 0
  let stopped = false
  let paused = false
  /** Bumped on every advance, so a late `end` cannot advance twice. */
  let turn = 0
  let spokeAt = Date.now()

  /*
   * A live reference to the utterance being spoken.
   *
   * Not a tidiness detail. Chrome can garbage-collect an utterance that only
   * the browser's internal queue still points at, and when it does, `onend`
   * never fires and the chain stops for good. Holding it here is what keeps
   * that from happening.
   */
  let current: SpeechSynthesisUtterance | null = null

  let watchdog = 0

  const cleanup = () => {
    window.clearInterval(watchdog)

    /*
     * Detach before dropping it. `cancel()` fires `error: interrupted` on the
     * utterance that was speaking, and a handler still attached to a chunk
     * from a chapter nobody is reading any more would advance a chain that is
     * supposed to be over.
     */
    if (current) {
      current.onstart = null
      current.onend = null
      current.onerror = null
      current = null
    }
  }

  const advance = (from: number) => {
    if (stopped || from !== turn) return
    turn += 1
    index += 1
    spokeAt = Date.now()
    say()
  }

  function say() {
    if (stopped) return

    if (index >= chunks.length) {
      cleanup()
      options.onEnd?.()
      return
    }

    const chunk = chunks[index]
    if (!chunk || !chunk.text.trim()) {
      index += 1
      say()
      return
    }

    const mine = turn

    /*
     * Per chunk, not once per chapter: a character's voice is the whole point
     * of `SpeechChunk.voiceId`, and `voice` is a property of the utterance.
     */
    const voice = (chunk.voiceId ? byId.get(chunk.voiceId) : null) ?? narrator

    const utterance = new SpeechSynthesisUtterance(chunk.text)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang ?? 'zh-TW'
    // Clamped to what the API accepts, so a bad multiplier cannot silence it.
    utterance.rate = clamp(options.rate * (chunk.rate ?? 1), 0.1, 10)
    utterance.pitch = clamp(options.pitch * (chunk.pitch ?? 1), 0, 2)
    utterance.volume = options.volume

    utterance.onstart = () => {
      spokeAt = Date.now()
      options.onBoundary?.(chunk.paragraph)
    }

    utterance.onend = () => {
      spokeAt = Date.now()
      advance(mine)
    }

    utterance.onerror = (event) => {
      // `interrupted` and `canceled` are what stopping looks like; they are
      // not failures and must not surface as one.
      if (event.error === 'interrupted' || event.error === 'canceled') return

      /*
       * Anything else is this one chunk failing, not the chapter. Skipping a
       * line is a far better outcome than stopping the reading — which is
       * what the old code did for every error.
       */
      advance(mine)
    }

    current = utterance
    spokeAt = Date.now()
    synth.speak(utterance)
  }

  /*
   * The watchdog.
   *
   * There used to be a `pause()` / `resume()` poke here every ten seconds —
   * the standard workaround for Chrome cutting a long utterance off at
   * fifteen. With this novel's paragraphs (median 12 characters, about three
   * seconds) no utterance ever comes close to that limit, so the poke had
   * nothing to fix and could only break things: on some platforms' local
   * voices a `pause()` landing between two utterances never resumes, and the
   * reading dies around the ten second mark. Which is two or three
   * paragraphs in — exactly the reported symptom.
   *
   * So nothing pokes a queue that is working. This only watches: when the
   * browser is neither speaking nor holding anything queued, and has not been
   * for two seconds, the `end` event is not coming. Move on.
   */
  watchdog = window.setInterval(() => {
    if (stopped || paused) return

    if (synth.speaking || synth.pending) {
      spokeAt = Date.now()
      return
    }

    if (Date.now() - spokeAt < SILENCE_MS) return

    advance(turn)
  }, WATCH_MS)

  say()

  return {
    stop: () => {
      stopped = true
      cleanup()
      synth.cancel()
    },
    pause: () => {
      paused = true
      synth.pause()
    },
    resume: () => {
      paused = false
      synth.resume()
      spokeAt = Date.now()

      /*
       * `resume()` is unreliable on some platforms: it returns, `paused`
       * goes false, and nothing comes out. Nudging the queue back to life
       * from the current chunk is the only recovery that does not need the
       * reader to work out what happened.
       */
      window.setTimeout(() => {
        if (stopped || paused) return
        if (synth.speaking || synth.pending) return
        turn += 1
        say()
      }, 350)
    },
  }
}
