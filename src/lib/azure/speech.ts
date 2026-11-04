import { env } from '@/lib/env'

/**
 * Azure Speech — 一把金鑰，兩件事 (Z129 / Z131).
 *
 * 文字轉語音做有聲小說，語音轉文字幫歌詞標時間。同一個資源、同一把金鑰，
 * 這正是選 Azure 而不是兩家供應商的理由：第二個註冊就是第二份帳單、第二個
 * 主控台、第二個要輪換的東西。
 *
 * 全部是 REST，沒有 SDK。Speech SDK 綁 Node 的原生模組，在 Vercel 的無伺服器
 * 環境上是一條會在部署時才發現的路；而這裡要用的兩個端點各自就是一個 POST。
 *
 * **金鑰只在伺服器端。** 這個檔案沒有 `'use client'`，而且永遠不會有。
 */

export type SpeechConfig = { key: string; region: string }

/**
 * Reads the credential, tolerating how it got into `.env.local`.
 *
 * Trimmed and unquoted because a value pasted from a portal arrives with
 * whatever the clipboard had. Diagnosing a 401 caused by a trailing newline
 * costs an hour; this costs two lines.
 */
export function speechConfig(): SpeechConfig | null {
  const { AZURE_SPEECH_KEY, AZURE_SPEECH_REGION } = env()

  const key = (AZURE_SPEECH_KEY ?? '').trim().replace(/^["']|["']$/g, '')
  const region = (AZURE_SPEECH_REGION ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()

  if (!key || !region) return null
  return { key, region }
}

/** `https://eastasia.tts.speech.microsoft.com` */
function ttsHost(region: string): string {
  return `https://${region}.tts.speech.microsoft.com`
}

/** `https://eastasia.api.cognitive.microsoft.com` */
function apiHost(region: string): string {
  return `https://${region}.api.cognitive.microsoft.com`
}

export type SpeechStatus =
  | { available: true; detail: string; voices: number }
  | { available: false; reason: 'missing_key' | 'unauthorized' | 'error'; detail: string }

/**
 * Whether the credential actually works, and when it does not, **why**.
 *
 * Probes the voice list because it is the cheapest authenticated call Azure
 * has — and because the answer is useful on its own: the number of voices is
 * what decides whether multi-character narration is possible.
 *
 * The 401 message is written out in full rather than reduced to 「連不上」.
 * The three things that cause it — wrong key, wrong region, wrong kind of
 * resource — are indistinguishable from the HTTP status, and only the person
 * with the portal open can tell them apart.
 */
export async function speechStatus(): Promise<SpeechStatus> {
  const config = speechConfig()
  if (!config) {
    return {
      available: false,
      reason: 'missing_key',
      detail: '尚未設定 AZURE_SPEECH_KEY / AZURE_SPEECH_REGION。',
    }
  }

  try {
    const response = await fetch(`${ttsHost(config.region)}/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': config.key },
    })

    if (response.status === 401 || response.status === 403) {
      return {
        available: false,
        reason: 'unauthorized',
        detail:
          `Azure 回 ${response.status}：金鑰或區域不對。要確認三件事——` +
          `這把金鑰是不是「語音服務（Speech service）」資源的、` +
          `區域是不是跟資源頁上的 Location 一致（目前填的是 ${config.region}）、` +
          `以及用的是不是「金鑰和端點」頁上的 KEY 1。`,
      }
    }

    if (!response.ok) {
      return {
        available: false,
        reason: 'error',
        detail: `Azure 回 ${response.status}：${(await response.text()).slice(0, 200)}`,
      }
    }

    const voices = (await response.json()) as unknown[]
    return {
      available: true,
      detail: `可以用，${voices.length} 個音色`,
      voices: voices.length,
    }
  } catch (cause) {
    return {
      available: false,
      reason: 'error',
      detail: cause instanceof Error ? cause.message : '連不上 Azure',
    }
  }
}

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'SpeechError'
  }
}

/** 4xx is ours to fix; 429 and 5xx are worth trying again. */
function speechError(status: number, body: string): SpeechError {
  const retryable = status === 429 || status >= 500
  const detail = body.slice(0, 300).replace(/\s+/g, ' ')

  if (status === 401 || status === 403) {
    return new SpeechError(
      'Azure 金鑰或區域不對（401）。到系統設定看「語音服務」那一段的說明。',
      status,
      false
    )
  }

  return new SpeechError(`Azure 回 ${status}：${detail}`, status, retryable)
}

/* -------------------------------------------------------------------------- */
/* 文字轉語音                                                                  */
/* -------------------------------------------------------------------------- */

export type Voice = {
  /** The id used in SSML, e.g. `zh-TW-HsiaoChenNeural`. */
  id: string
  locale: string
  gender: string
  /** 「曉臻」 rather than `HsiaoChen`, when Azure provides it. */
  label: string
  /** 情緒風格: cheerful / sad / angry…. Empty where the voice has none. */
  styles: string[]
}

/**
 * The voices this account can actually use.
 *
 * Asked at runtime rather than written down. A hardcoded list is wrong the
 * day Azure adds a voice, and it cannot know which ones a given region
 * serves — and the inventory is the whole question for multi-character
 * narration: zh-TW has three voices, zh-CN has twenty-odd, and which to use
 * is a decision somebody should make while looking at the real list.
 */
export async function listVoices(locale?: string): Promise<Voice[]> {
  const config = speechConfig()
  if (!config) throw new SpeechError('尚未設定 Azure 語音服務', 0, false)

  const response = await fetch(`${ttsHost(config.region)}/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': config.key },
  })

  if (!response.ok) throw speechError(response.status, await response.text())

  const rows = (await response.json()) as {
    ShortName?: string
    Locale?: string
    Gender?: string
    LocalName?: string
    DisplayName?: string
    StyleList?: string[]
  }[]

  return rows
    .filter((row) => !locale || (row.Locale ?? '').toLowerCase().startsWith(locale.toLowerCase()))
    .map((row) => ({
      id: row.ShortName ?? '',
      locale: row.Locale ?? '',
      gender: row.Gender ?? '',
      label: row.LocalName || row.DisplayName || row.ShortName || '',
      styles: row.StyleList ?? [],
    }))
    .filter((voice) => voice.id)
}

/** 24kHz mono MP3 — small enough to store per episode, good enough to listen to. */
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

/**
 * Renders one SSML document to audio.
 *
 * Returns the bytes. Chunking a whole episode into documents that each stay
 * inside Azure's ten-minute output limit is `src/lib/tts/ssml.ts`'s job — by
 * the time anything gets here it is one request's worth.
 */
export async function synthesize(ssml: string): Promise<Buffer> {
  const config = speechConfig()
  if (!config) throw new SpeechError('尚未設定 Azure 語音服務', 0, false)

  const response = await fetch(`${ttsHost(config.region)}/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': AUDIO_FORMAT,
      // Azure asks for one; a generic name is the right answer (never the
      // user's email, whatever a service suggests).
      'User-Agent': 'snowrealm-drama-studio',
    },
    body: ssml,
  })

  if (!response.ok) throw speechError(response.status, await response.text())

  return Buffer.from(await response.arrayBuffer())
}

/* -------------------------------------------------------------------------- */
/* 語音轉文字                                                                  */
/* -------------------------------------------------------------------------- */

export type TranscribedWord = {
  text: string
  startMs: number
  durationMs: number
}

export type Transcription = {
  words: TranscribedWord[]
  /** Everything it thought it heard, for 「它到底聽到什麼」. */
  text: string
  /** Null when the response carried no word-level detail. */
  durationMs: number | null
}

/**
 * Transcribes a whole file, with a time on every word.
 *
 * Fast transcription rather than the pronunciation-assessment endpoint, which
 * would have been the better technique — it aligns against a reference text
 * you already have — but **caps the audio at thirty seconds**. Chunking a
 * song into thirty-second windows requires knowing which lines fall in which
 * window, which is the thing being worked out. So: transcribe the lot, then
 * align the result against the known lyrics ourselves
 * (`src/lib/lyrics-align.ts`).
 *
 * Nothing here assumes the recognition is correct. On sung vocals over a
 * backing track it frequently is not — and it does not need to be, because
 * alignment uses the *order* of what was heard, not its accuracy.
 */
export async function transcribe(input: {
  audio: Buffer
  mimeType: string
  fileName: string
  /** Candidate languages; Azure picks. zh-TW first for this studio. */
  locales?: string[]
}): Promise<Transcription> {
  const config = speechConfig()
  if (!config) throw new SpeechError('尚未設定 Azure 語音服務', 0, false)

  const form = new FormData()
  form.append(
    'audio',
    new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
    input.fileName
  )
  form.append(
    'definition',
    JSON.stringify({
      locales: input.locales ?? ['zh-TW', 'zh-CN'],
      // Lyrics are lyrics. A filtered transcript would misalign at the
      // asterisks rather than protect anybody from their own song.
      profanityFilterMode: 'None',
    })
  )

  const response = await fetch(
    `${apiHost(config.region)}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': config.key },
      body: form,
    }
  )

  if (!response.ok) throw speechError(response.status, await response.text())

  const body = (await response.json()) as {
    durationMilliseconds?: number
    combinedPhrases?: { text?: string }[]
    phrases?: {
      text?: string
      offsetMilliseconds?: number
      durationMilliseconds?: number
      words?: { text?: string; offsetMilliseconds?: number; durationMilliseconds?: number }[]
    }[]
  }

  const words: TranscribedWord[] = []

  for (const phrase of body.phrases ?? []) {
    if (phrase.words && phrase.words.length > 0) {
      for (const word of phrase.words) {
        if (!word.text) continue
        words.push({
          text: word.text,
          startMs: word.offsetMilliseconds ?? 0,
          durationMs: word.durationMilliseconds ?? 0,
        })
      }
      continue
    }

    /*
     * No word-level detail on this phrase — fall back to the phrase itself.
     * Coarser, but a phrase is still a cue, and the aligner spreads a token's
     * duration across its characters either way. Returning nothing because
     * the response was less detailed than hoped would be worse.
     */
    if (phrase.text) {
      words.push({
        text: phrase.text,
        startMs: phrase.offsetMilliseconds ?? 0,
        durationMs: phrase.durationMilliseconds ?? 0,
      })
    }
  }

  return {
    words,
    text: (body.combinedPhrases ?? []).map((row) => row.text ?? '').join(''),
    durationMs: body.durationMilliseconds ?? null,
  }
}
