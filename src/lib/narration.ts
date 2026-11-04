/**
 * 分角色朗讀：誰在說話、用什麼語氣（Z111）。
 *
 * Pure text work, no database and no model. The reader already speaks one
 * chunk at a time, and `voice`, `pitch` and `rate` are per-utterance, so the
 * only missing piece was deciding what each chunk *is*.
 *
 * **The honest limit is the voice supply.** A browser ships two or three
 * Chinese voices, not twenty, so characters are told apart mostly by pitch and
 * rate rather than by timbre. It reads as one narrator doing different voices,
 * which is what an audiobook of this budget sounds like anyway.
 *
 * The other limit is attribution. This novel's dialogue is mostly bare:
 *
 *     「不夠。」
 *     「那就三文錢半。」
 *
 * Nothing in those lines says who is speaking. The rule here is to assign a
 * character **only when the text names one that actually exists in this
 * work** — otherwise the narrator's voice reads it. Guessing wrong is more
 * distracting than not splitting voices at all, because a wrong voice asserts
 * something false about the scene.
 */

/* -------------------------------------------------------------------------- */
/* Tone                                                                        */
/* -------------------------------------------------------------------------- */

export const TONES = ['plain', 'loud', 'soft', 'question'] as const
export type Tone = (typeof TONES)[number]

/**
 * How each tone bends the voice.
 *
 * Multipliers on whatever the reader's own rate is set to, so someone who
 * reads at 1.4× keeps their pace and still hears the difference.
 */
export const TONE_SHAPE: Record<Tone, { rate: number; pitch: number }> = {
  plain: { rate: 1, pitch: 1 },
  /** 喊、喝、吼：faster and higher, the way a raised voice actually moves. */
  loud: { rate: 1.12, pitch: 1.15 },
  /** 低聲、喃喃、嘆：slower and lower. */
  soft: { rate: 0.88, pitch: 0.92 },
  /** A question lifts at the end; the engine cannot do that, so lift it all. */
  question: { rate: 1, pitch: 1.08 },
}

/**
 * Dialogue, as distinct from narration — regardless of who is speaking.
 *
 * Measured on this novel's first chapter: 74 of 238 paragraphs are dialogue
 * and **none of them name their speaker in the same paragraph**. So character
 * voices almost never fire here, and without this the setting would be
 * audibly indistinguishable from leaving it off.
 *
 * Telling speech from narration needs no attribution at all — the quote marks
 * are right there — and it is most of what a reader is listening for.
 */
export const DIALOGUE_SHAPE = { rate: 1.05, pitch: 1.07 }

/** Whether this paragraph is somebody speaking. */
export function isDialogue(text: string): boolean {
  return new RegExp(`[${OPEN}]`).test(text)
}

/** The quote marks a Chinese novel actually uses. */
const OPEN = '「『“'
const CLOSE = '」』”'

const LOUD = /[喊吼嚷][著道]?|喝[道問斥]|厲聲|怒[道喝吼]|大[聲叫喊]|尖叫|咆哮/
const SOFT = /低[聲低]?[聲語道]?|喃喃|輕聲|嘆[了一]?[口氣]*|呢喃|小聲|默默|悄聲/

/**
 * Reads the mood off the punctuation and the verbs around it.
 *
 * The closing quote is stripped before the ending is examined. 「收攤了？」
 * ends with 」, not with 「？」 — anchoring on the raw string meant every
 * single line of dialogue in this novel came back `plain`, which is every
 * line that this feature exists for.
 */
export function toneOf(text: string, context = ''): Tone {
  const both = `${context}${text}`
  const inner = text.trim().replace(new RegExp(`^[${OPEN}]+|[${CLOSE}]+$`, 'g'), '').trim()

  // 「你說什麼？！」 is shouted, not asked: the exclamation wins.
  if (LOUD.test(both) || /！+$/.test(inner)) return 'loud'
  if (SOFT.test(both) || /…{2,}|⋯{2,}|……/.test(text)) return 'soft'
  if (/[？?]+$/.test(inner)) return 'question'
  return 'plain'
}

/* -------------------------------------------------------------------------- */
/* Who is speaking                                                             */
/* -------------------------------------------------------------------------- */

/** 說、道、問…… — the verbs that attach a name to a quote. */
const SPEECH_VERB =
  '說|説|道|問|问|答|回|喊|叫|吼|嘆|叹|笑|冷笑|苦笑|低聲|輕聲|喃喃|嘟囔|開口|接話|補充|解釋|反問|追問|應|应'

export type Speaker = {
  /** The character this was matched to. Null means narration or unknown. */
  name: string | null
  /** The text that justified it, for explaining the choice. */
  evidence: string
}

/**
 * Finds who said a quoted line, using only names this work actually has.
 *
 * Three shapes, in order of how sure they are:
 *
 *   沈知味說：「不夠。」      name before the quote
 *   「不夠。」沈知味說         name after the quote
 *   沈知味把碗推過去。「不夠。」 name earlier in the same paragraph
 *
 * A pronoun — 他、她 — is deliberately not resolved. Following pronouns back
 * through a scene is where this kind of parser starts being confidently wrong.
 */
export function speakerOf(paragraph: string, known: KnownName[]): Speaker {
  if (known.length === 0) return { name: null, evidence: '' }

  const quote = new RegExp(`[${OPEN}][^${CLOSE}]*[${CLOSE}]`)
  const match = quote.exec(paragraph)
  if (!match) return { name: null, evidence: '' }

  const before = paragraph.slice(0, match.index)
  const after = paragraph.slice(match.index + match[0].length)

  for (const entry of known) {
    for (const label of entry.labels) {
      // 沈知味說：「…」 / 沈知味冷笑道：「…」
      const lead = new RegExp(`${escape(label)}[^${OPEN}]{0,8}(?:${SPEECH_VERB})[：:，,]?\\s*$`)
      if (lead.test(before)) return { name: entry.name, evidence: `${label}…說` }

      // 「…」沈知味說
      const trail = new RegExp(`^[，,]?\\s*${escape(label)}[^。！？]{0,8}(?:${SPEECH_VERB})`)
      if (trail.test(after)) return { name: entry.name, evidence: `「…」${label}說` }
    }
  }

  // The looser one: a name anywhere before the quote in the same paragraph.
  for (const entry of known) {
    for (const label of entry.labels) {
      if (before.includes(label)) return { name: entry.name, evidence: `同段出現「${label}」` }
    }
  }

  return { name: null, evidence: '' }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type KnownName = {
  /** The character's id, for looking its voice up. */
  id: string
  name: string
  /** Name plus any alias, longest first so 「沈知味」 beats 「沈」. */
  labels: string[]
}

/** Builds the lookup, longest label first so a nickname cannot shadow a name. */
export function knownNames(
  characters: { id: string; name: string; alias?: string }[]
): KnownName[] {
  return characters
    .map((c) => ({
      id: c.id,
      name: c.name,
      labels: [c.name, ...(c.alias ?? '').split(/[、,，\s]+/)]
        .map((l) => l.trim())
        .filter((l) => l.length >= 2)
        .sort((a, b) => b.length - a.length),
    }))
    .filter((c) => c.labels.length > 0)
    .sort((a, b) => (b.labels[0]?.length ?? 0) - (a.labels[0]?.length ?? 0))
}

/* -------------------------------------------------------------------------- */
/* Voice assignment                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A voice to choose from.
 *
 * `gender` is optional because the browser does not report one —
 * `SpeechSynthesisVoice` has no such field. Azure does, and when it is there
 * it decides which pool a character draws from.
 */
export type VoiceOption = { id: string; lang: string; gender?: string }

export type VoiceSlot = {
  /** `voiceURI`, or null to use whatever the reader picked for narration. */
  voiceId: string | null
  pitch: number
  rate: number
}

export type CastMember = {
  id: string
  name: string
  /** Free text in this project: 「女」「男」「女性」…… */
  gender?: string
  tier?: string
  /** A stored override. Used only when that voice exists on this device. */
  voiceId?: string
}

/**
 * Hands every character a voice, deterministically.
 *
 * Deterministic matters more than clever: the same character must sound the
 * same tomorrow, and on the other member's machine when it has the same
 * voices. So the assignment is a function of the cast and the voice list, in a
 * fixed order — never random, never 「first come first served」 by reading
 * order.
 *
 * Gender steers pitch rather than picking the voice, because a machine with
 * one Chinese voice has no female voice to pick; pitch still separates them.
 */
export function assignVoices(
  cast: CastMember[],
  /** Available voices, Chinese first — `loadVoices()` already sorts that way. */
  voices: VoiceOption[]
): Record<string, VoiceSlot> {
  const chinese = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'))
  const pool = chinese.length > 0 ? chinese : voices

  /*
   * 音色本身有性別就照性別挑 (Z129).
   *
   * The original rule was 「gender steers pitch, not which voice」, and for
   * browser voices that is right: `SpeechSynthesisVoice` has no gender, and a
   * machine with one Chinese voice has no female voice to pick. But the
   * per-gender counters below start at zero for each gender, so a female lead
   * and a male lead both landed on `pool[0]` — **the same voice** — separated
   * only by pitch.
   *
   * Azure's list does carry gender, and a male voice pitched up is not a
   * female voice. So when the pool is gendered, each side draws from its own;
   * when it is not, every pool is the whole pool and this is exactly the old
   * behaviour.
   */
  /**
   * Classifies a voice, **female first**.
   *
   * 「female」 contains 「male」, so a bare `/male/i` matches every female
   * voice Azure lists. The first version of this did exactly that and the
   * male pool silently became the whole pool — both leads landed on the same
   * voice, which is the bug this whole block exists to fix.
   */
  const voiceGender = (value?: string): 'female' | 'male' | 'other' => {
    const text = (value ?? '').toLowerCase()
    if (/female|女/.test(text)) return 'female'
    if (/male|男/.test(text)) return 'male'
    return 'other'
  }

  const poolFor = (want: 'female' | 'male') => {
    const matching = pool.filter((voice) => voiceGender(voice.gender) === want)
    // No gendered voices at all — the browser case. Old behaviour exactly.
    return matching.length > 0 ? matching : pool
  }

  const femalePool = poolFor('female')
  const malePool = poolFor('male')

  /*
   * Pitch steps, spread around the narrator's 1.0 and never reaching it — the
   * narrator has to stay distinguishable from every character.
   */
  const HIGH = [1.22, 1.34, 1.12, 1.28]
  const LOW = [0.84, 0.72, 0.92, 0.78]
  const NEUTRAL = [1.18, 0.86, 1.3, 0.76]

  const out: Record<string, VoiceSlot> = {}
  const available = new Set(voices.map((v) => v.id))

  // A stable order, so adding a character later does not reshuffle the others.
  const ordered = [...cast].sort((a, b) => a.id.localeCompare(b.id))

  let female = 0
  let male = 0
  let other = 0

  for (const member of ordered) {
    const steps = /女|female|f$/i.test(member.gender ?? '')
      ? HIGH
      : /男|male|m$/i.test(member.gender ?? '')
        ? LOW
        : NEUTRAL

    const index = steps === HIGH ? female++ : steps === LOW ? male++ : other++

    /*
     * An override is honoured only when that voice exists here. A `voiceURI`
     * saved on Windows means nothing on a phone, and handing the synthesiser
     * a voice it does not have gets you silence, not a fallback.
     */
    const override = member.voiceId && available.has(member.voiceId) ? member.voiceId : null

    const ownPool = steps === HIGH ? femalePool : steps === LOW ? malePool : pool

    out[member.id] = {
      voiceId: override ?? ownPool[index % Math.max(1, ownPool.length)]?.id ?? null,
      pitch: steps[index % steps.length] ?? 1,
      // A touch of variation so two characters sharing a pitch still differ.
      rate: 1 + ((index % 3) - 1) * 0.04,
    }
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* Putting it together                                                         */
/* -------------------------------------------------------------------------- */

export type CastedChunk = {
  text: string
  paragraph: number
  voiceId?: string | null
  rate?: number
  pitch?: number
  speaker?: string | null
}

/**
 * Gives each chunk a voice and a tone.
 *
 * Attribution is decided **per paragraph**, not per chunk: a long line of
 * dialogue is several chunks, and 「沈知味說：」 appears in only the first of
 * them. Deciding per chunk would switch to the narrator halfway through
 * somebody's sentence.
 */
export function castChunks(
  chunks: { text: string; paragraph: number }[],
  paragraphs: string[],
  cast: CastMember[],
  voices: VoiceOption[]
): CastedChunk[] {
  if (cast.length === 0) return chunks

  const names = knownNames(cast)
  const slots = assignVoices(cast, voices)
  const byName = new Map(cast.map((c) => [c.name, c.id]))

  /** paragraph index → who said it, worked out once. */
  const speakers = new Map<number, string | null>()

  return chunks.map((chunk) => {
    const paragraph = paragraphs[chunk.paragraph] ?? ''

    if (!speakers.has(chunk.paragraph)) {
      speakers.set(chunk.paragraph, speakerOf(paragraph, names).name)
    }
    const speaker = speakers.get(chunk.paragraph) ?? null

    const tone = TONE_SHAPE[toneOf(chunk.text, paragraph)]
    const slot = speaker ? slots[byName.get(speaker) ?? ''] : undefined
    const spoken = isDialogue(chunk.text) || isDialogue(paragraph)

    /*
     * Three things stack: is it speech at all, what mood is it in, and whose
     * voice is it. The first one needs no attribution, which is why it
     * carries this feature on prose that never names its speakers.
     */
    const lift = spoken && !slot ? DIALOGUE_SHAPE : { rate: 1, pitch: 1 }

    return {
      ...chunk,
      speaker,
      voiceId: slot?.voiceId ?? null,
      rate: tone.rate * (slot?.rate ?? 1) * lift.rate,
      pitch: tone.pitch * (slot?.pitch ?? 1) * lift.pitch,
    }
  })
}
