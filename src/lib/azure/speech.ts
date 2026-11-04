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

/* -------------------------------------------------------------------------- */
/* 華語音色                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 哪一種華語。
 *
 * 這個分類不是講究，是**唸出來真的不一樣**：
 *
 * - `mandarin` —— 官話。`zh-CN` / `zh-TW`，以及河南、遼寧、陝西、山東、四川
 *   那幾個，後面這些是**帶地方口音的普通話**，拿來配角色很有味道。
 * - `cantonese` —— `zh-HK` 與 `yue-CN`。它們會把同一份中文**唸成粵語**，
 *   不是帶廣東腔的國語。
 * - `wu` —— `wuu-CN`，唸成上海話。
 *
 * 分出來是為了讓「某個角色開口變成講粵語」是一個**看得到的選擇**，而不是
 * 自動分配時悄悄發生的意外。
 */
export type ChineseVariety = 'mandarin' | 'cantonese' | 'wu'

export const CHINESE_VARIETY_LABEL: Record<ChineseVariety, string> = {
  mandarin: '官話',
  cantonese: '粵語',
  wu: '吳語',
}

/** Null for anything that is not a Chinese voice. */
export function chineseVariety(locale: string): ChineseVariety | null {
  const tag = locale.toLowerCase()
  if (tag.startsWith('yue')) return 'cantonese'
  if (tag.startsWith('wuu')) return 'wu'
  if (!tag.startsWith('zh')) return null
  // zh-HK is Cantonese; every other zh-* on Azure is Mandarin, including the
  // five regional accents.
  return tag.startsWith('zh-hk') ? 'cantonese' : 'mandarin'
}

/**
 * 一個音色在這個工作室裡派得上什麼用場。
 *
 * 分層的根據只有一件事：**它會把中文唸成什麼。**
 *
 * - `mandarin` —— `zh-CN` / `zh-TW` 與五個地方口音。地方的是帶口音的普通話。
 * - `multilingual` —— 名字裡有 Multilingual 的那 57 個。它們的 locale 是
 *   `en-US` 之類，但**能把中文唸成標準國語**，而且同一把嗓子還能講英日韓——
 *   一個會說兩種語言的角色，用這個才不會換人。
 * - `cantonese` / `wu` —— 會把同一份中文唸成粵語或上海話。不是口音，是另一
 *   種話。
 * - `foreign` —— 純英日韓。拿去唸中文會唸成日文漢字音那種，只有在台詞本身
 *   就是那個語言時才對。
 */
export type VoiceTier = 'mandarin' | 'multilingual' | 'cantonese' | 'wu' | 'foreign'

export const VOICE_TIER_LABEL: Record<VoiceTier, string> = {
  mandarin: '官話',
  multilingual: '多語言',
  cantonese: '粵語',
  wu: '吳語',
  foreign: '外語',
}

/** Foreign languages worth offering. English is narrowed to two regions. */
const FOREIGN_LOCALES = /^(ja-JP|ko-KR|en-US|en-GB)$/i

export type PooledVoice = Voice & {
  tier: VoiceTier
  /** Whether it reads Chinese as Mandarin — what the caster actually needs. */
  speaksChinese: boolean
}

function tierOf(voice: Voice): VoiceTier | null {
  if (/multilingual/i.test(voice.id)) return 'multilingual'

  const variety = chineseVariety(voice.locale)
  if (variety) return variety === 'mandarin' ? 'mandarin' : variety

  return FOREIGN_LOCALES.test(voice.locale) ? 'foreign' : null
}

const TIER_ORDER: VoiceTier[] = ['mandarin', 'multilingual', 'cantonese', 'wu', 'foreign']

/**
 * The voices this studio offers, best-for-Chinese first.
 *
 * 「所有中文都用上」 plus 「加幾個英文日文韓文」—— so nothing Chinese is
 * filtered out, and the foreign side is narrowed to ja-JP, ko-KR, en-US and
 * en-GB rather than all 124 English voices across fourteen regions.
 *
 * The order is what keeps a mixed pool safe. A cast of ten draws ten Mandarin
 * voices; the Cantonese ones only come up once the Mandarin and multilingual
 * ones run out, or when somebody picks one deliberately. Nothing starts
 * speaking Cantonese by accident.
 *
 * Within 官話, voices carrying emotion styles come first — those are the ones
 * that can act on the tone `narration.ts` has already worked out.
 */
export async function voicePool(): Promise<PooledVoice[]> {
  const all = await listVoices()

  const pooled = all
    .map((voice) => ({ voice, tier: tierOf(voice) }))
    .filter((row): row is { voice: Voice; tier: VoiceTier } => row.tier !== null)
    .map(({ voice, tier }) => ({
      ...voice,
      tier,
      speaksChinese: tier === 'mandarin' || tier === 'multilingual',
    }))

  return pooled.sort((a, b) => {
    const byTier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
    if (byTier !== 0) return byTier
    // Emotion styles first inside 官話; they can act on the tone.
    if (a.tier === 'mandarin' && a.styles.length !== b.styles.length) {
      return b.styles.length - a.styles.length
    }
    return a.id.localeCompare(b.id)
  })
}

/** 24kHz mono MP3 — small enough to store per episode, good enough to listen to. */
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

/**
 * 位元率，從上面那個格式名字來的 (Z138).
 *
 * 匯出的用途只有一個：**算出音檔真正多長**。MP3 是定位元率，所以
 * 秒數 = 位元組 × 8 ÷ 位元率，而且算出來跟播放器一致。
 *
 * 之前存的是合成**前**用「字數 ÷ 每秒 3.9 字」估的數字——那是用來切批次的
 * 預算，拿來當長度就短了 9%：播放器說 15:01，我們寫 13 分 42 秒。
 *
 * 兩個常數綁在一起，不要各寫一份：改了格式卻忘了改位元率，算出來的長度會
 * 安靜地錯。
 */
export const AUDIO_BITRATE = 48_000

/** 位元組 → 秒，照上面的位元率。 */
export function durationFromBytes(bytes: number): number {
  return (bytes * 8) / AUDIO_BITRATE
}

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
