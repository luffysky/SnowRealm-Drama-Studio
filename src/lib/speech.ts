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

/**
 * Splits prose into utterances.
 *
 * Long strings are unreliable: Chrome truncates somewhere past a few thousand
 * characters, and a single utterance cannot be resumed partway. Splitting on
 * sentence endings also gives the caller somewhere to report progress and
 * somewhere to stop cleanly.
 */
export function splitForSpeech(paragraphs: string[], maxChars = 180): string[] {
  const out: string[] = []

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      // Keep the punctuation: it is what makes the synthesiser pause.
      .split(/(?<=[。！？!?；;…])/)
      .map((s) => s.trim())
      .filter(Boolean)

    let buffer = ''
    for (const sentence of sentences) {
      if (buffer && buffer.length + sentence.length > maxChars) {
        out.push(buffer)
        buffer = sentence
      } else {
        buffer += sentence
      }
    }
    if (buffer) out.push(buffer)
  }

  return out
}

export type SpeakOptions = {
  voiceId?: string | undefined
  rate: number
  pitch: number
  volume: number
  onBoundary?: (index: number) => void
  onEnd?: () => void
  onError?: () => void
}

/**
 * Reads a list of chunks aloud, in order.
 *
 * Returns a stop function. Speaking is a single global queue in the browser,
 * so starting a second one without stopping the first produces both at once.
 */
export function speak(chunks: string[], options: SpeakOptions): () => void {
  if (!speechSupported() || chunks.length === 0) return () => {}

  const synth = window.speechSynthesis
  synth.cancel()

  const voices = synth.getVoices()
  const voice = options.voiceId
    ? (voices.find((v) => v.voiceURI === options.voiceId) ?? null)
    : null

  let index = 0
  let stopped = false

  /*
   * Chrome stops synthesising after roughly fifteen seconds unless it is
   * poked. This is a long-standing bug with no better workaround; without it
   * the reading dies mid-chapter and looks like a crash.
   */
  const keepAlive = window.setInterval(() => {
    if (stopped) return
    if (synth.speaking && !synth.paused) {
      synth.pause()
      synth.resume()
    }
  }, 10_000)

  const next = () => {
    if (stopped || index >= chunks.length) {
      window.clearInterval(keepAlive)
      if (!stopped) options.onEnd?.()
      return
    }

    const chunk = chunks[index]
    if (!chunk) {
      index += 1
      next()
      return
    }

    const utterance = new SpeechSynthesisUtterance(chunk)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang ?? 'zh-TW'
    utterance.rate = options.rate
    utterance.pitch = options.pitch
    utterance.volume = options.volume

    utterance.onstart = () => options.onBoundary?.(index)

    utterance.onend = () => {
      index += 1
      next()
    }

    utterance.onerror = (event) => {
      // `interrupted` and `canceled` are what stopping looks like; they are
      // not failures and must not surface as one.
      if (event.error === 'interrupted' || event.error === 'canceled') return
      window.clearInterval(keepAlive)
      options.onError?.()
    }

    synth.speak(utterance)
  }

  next()

  return () => {
    stopped = true
    window.clearInterval(keepAlive)
    synth.cancel()
  }
}

export function pauseSpeech(): void {
  if (speechSupported()) window.speechSynthesis.pause()
}

export function resumeSpeech(): void {
  if (speechSupported()) window.speechSynthesis.resume()
}
