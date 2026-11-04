import { isDialogue, knownNames, speakerOf, type CastMember } from '@/lib/narration'

/**
 * 這句話是誰說的 (Z132).
 *
 * `speakerOf` 只認得「名字 ＋ 說話動詞」的句型，而且刻意不解析代名詞——跟著
 * 「他」「她」在場景裡往回追，正是這種剖析器開始自信地犯錯的地方。
 *
 * 量過真正的正文之後，問題的規模是這樣的：
 *
 *   已寫 9 集，6,623 段，其中對白 2,657 段（40%）
 *   規則判得出是誰說的：**0 段**
 *
 * 零。所以照現在的狀態合成，兩千多段對白會全部用旁白的聲音唸——所謂的多角色
 * 有聲書會是一個人從頭唸到尾。這不是潤飾，是這個功能成不成立的分界。
 *
 * 所以讓模型讀整章，補規則接不住的三種情況：沒有說話標記的對白、一來一往的
 * 對話、以及「那名男子」這種還沒揭曉姓名的指稱。
 *
 * 這個檔案不碰網路也不碰資料庫。歸屬錯了是「聽完整集才發現全錯」的那種錯，
 * 跟 SSML 與歌詞對齊同一個理由：能用測試問的，就不要用耳朵問。
 *
 * 兩條規矩貫穿全檔：
 *
 *  1. **規則判得出來的不送給模型。** 確定的事不需要問，而且問了就給了它一個
 *     跟確定答案唱反調的機會。
 *  2. **模型回的答案要驗。** 它可能回超出範圍的段號、回角色表裡沒有的人、
 *     或者乾脆回一段散文。這些全部要擋在資料進到配音之前。
 */

/** One line the model is being asked about. */
export type AttributionAsk = {
  /** Index into the paragraph array it came from. */
  index: number
  text: string
}

export type AttributionPlan = {
  /** Answered by the rules. Never sent, never overridden. */
  settled: { index: number; speaker: string; evidence: string }[]
  /** What the model is asked to attribute. */
  ask: AttributionAsk[]
  /** The prose it reads, numbered so the indices line up. */
  excerpt: string
  /** Names it is allowed to choose from. */
  cast: string[]
}

/**
 * Works out what to ask.
 *
 * Narration is skipped — only quoted lines have a speaker — and so is anything
 * the rules already settled. On this novel that second filter currently
 * removes nothing, but it is the right shape: as the cast table fills in, more
 * lines become certain, and certain things should not be put to a vote.
 */
export function planAttribution(
  paragraphs: string[],
  cast: CastMember[],
  options: { maxLines?: number } = {}
): AttributionPlan {
  const names = knownNames(cast)

  const settled: AttributionPlan['settled'] = []
  const ask: AttributionAsk[] = []

  paragraphs.forEach((paragraph, index) => {
    const text = paragraph.trim()
    if (!text || !isDialogue(text)) return

    const found = speakerOf(text, names)
    if (found.name) {
      settled.push({ index, speaker: found.name, evidence: found.evidence })
      return
    }

    ask.push({ index, text })
  })

  /*
   * A ceiling on one request. An episode of this novel is roughly 300 lines of
   * dialogue, which fits; a caller handing over the whole book would not, and
   * the failure would be a truncated answer that looks complete.
   */
  const limited = options.maxLines ? ask.slice(0, options.maxLines) : ask

  return {
    settled,
    ask: limited,
    excerpt: numbered(paragraphs),
    cast: cast.map((member) => member.name),
  }
}

/**
 * The prose with a number on every paragraph.
 *
 * The model needs the **whole** passage, not just the lines in question: who
 * speaks an unmarked line is decided by what surrounds it. Numbering every
 * paragraph rather than only the asked ones keeps the indices honest — a
 * separate numbering would be one off-by-one away from giving every line the
 * wrong voice.
 */
export function numbered(paragraphs: string[]): string {
  return paragraphs.map((text, index) => `[${index}] ${text.trim()}`).join('\n')
}

export type AttributedLine = {
  index: number
  /** Null means the model declined — narration, or it could not tell. */
  speaker: string | null
  /**
   * 男 / 女 / null，決定配音用男聲還是女聲 (Z132).
   *
   * Asked for because the model is already reading the prose and the answer
   * is usually written in the appellation itself — 婦人、嬸子、小男孩、老伯.
   * Without it every speaker the cast table has never heard of falls into the
   * neutral pool and takes whatever voice comes next: the first run put 婦人
   * and 賣包子的嬸子 in men's voices and 陸承安 in a woman's.
   */
  gender: string | null
  /** The model named somebody who is not in the cast table. */
  isNew: boolean
  /** 0–1 as reported. Clamped; a missing one is treated as uncertain. */
  confidence: number
  reason: string
}

/** What came back, and what had to be thrown away. */
export type AttributionResult = {
  lines: AttributedLine[]
  /** Names not in the cast table — the people worth adding to it. */
  newNames: string[]
  /** Entries dropped, and why, so a bad run is visible rather than silent. */
  rejected: { index: number | null; reason: string }[]
}

/**
 * Parses the model's answer, and distrusts it.
 *
 * Everything here is a real failure seen from language models on this kind of
 * task: a JSON array wrapped in prose, a fenced code block, an index that was
 * never asked about, a speaker invented wholesale, a confidence of 95 meaning
 * 95%. None of them should reach the voice assignment.
 */
export function parseAttribution(raw: string, plan: AttributionPlan): AttributionResult {
  const asked = new Set(plan.ask.map((line) => line.index))
  const castNames = new Set(plan.cast)

  const lines: AttributedLine[] = []
  const rejected: AttributionResult['rejected'] = []
  const newNames = new Set<string>()

  const parsed = extractJson(raw)
  if (!parsed) {
    return { lines: [], newNames: [], rejected: [{ index: null, reason: '回應裡找不到 JSON' }] }
  }

  const seen = new Set<number>()

  for (const entry of parsed) {
    const index = Number((entry as { index?: unknown }).index)
    if (!Number.isInteger(index)) {
      rejected.push({ index: null, reason: '段號不是整數' })
      continue
    }
    if (!asked.has(index)) {
      // Either invented, or an answer to a line the rules already settled.
      rejected.push({ index, reason: '這一段沒有問它' })
      continue
    }
    if (seen.has(index)) {
      rejected.push({ index, reason: '同一段回了兩次' })
      continue
    }
    seen.add(index)

    const rawSpeaker = (entry as { speaker?: unknown }).speaker
    const speaker =
      typeof rawSpeaker === 'string' && rawSpeaker.trim() ? rawSpeaker.trim() : null

    const isNew = speaker !== null && !castNames.has(speaker)
    if (isNew) newNames.add(speaker)

    const rawGender = (entry as { gender?: unknown }).gender
    const gender =
      typeof rawGender === 'string' && /^[男女]/.test(rawGender.trim())
        ? rawGender.trim()[0]!
        : null

    lines.push({
      index,
      speaker,
      gender,
      isNew,
      confidence: normaliseConfidence((entry as { confidence?: unknown }).confidence),
      reason: String((entry as { reason?: unknown }).reason ?? '').slice(0, 200),
    })
  }

  return { lines, newNames: [...newNames], rejected }
}

/**
 * Confidence, however it was written.
 *
 * `0.8`, `80` and `"80%"` all mean the same thing and all turn up. A missing
 * or unreadable one becomes 0 rather than 1: the cost of being wrong here is
 * a line in the wrong voice, so silence should not read as certainty.
 */
function normaliseConfidence(value: unknown): number {
  const number =
    typeof value === 'number' ? value : Number(String(value ?? '').replace('%', '').trim())

  if (!Number.isFinite(number)) return 0
  const scaled = number > 1 ? number / 100 : number
  return Math.max(0, Math.min(1, scaled))
}

/**
 * The first JSON array in the response.
 *
 * Fences and surrounding prose are stripped rather than refused: a model that
 * answered correctly and then added 「希望這樣有幫助」 has not failed, and
 * rejecting the whole episode over a closing sentence would be the wrong
 * trade.
 */
function extractJson(raw: string): unknown[] | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  const direct = tryParse(text)
  if (direct) return direct

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null

  return tryParse(text.slice(start, end + 1))
}

function tryParse(text: string): unknown[] | null {
  try {
    const value = JSON.parse(text) as unknown
    if (Array.isArray(value)) return value
    // Some models wrap it: { "lines": [...] }.
    if (value && typeof value === 'object') {
      for (const candidate of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(candidate)) return candidate
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * The final answer per paragraph, rules first.
 *
 * Below `minConfidence` a line stays unattributed and is read by the narrator.
 * That is deliberately the safe failure: an unattributed line sounds like
 * narration, which is merely flat, while a confidently wrong one puts 許山河's
 * words in 沈知味's mouth — and somebody listening will believe it.
 */
export function mergeAttribution(
  plan: AttributionPlan,
  result: AttributionResult,
  options: { minConfidence?: number; includeNew?: boolean } = {}
): Map<number, string> {
  const minConfidence = options.minConfidence ?? 0.5
  const out = new Map<number, string>()

  for (const line of plan.settled) out.set(line.index, line.speaker)

  for (const line of result.lines) {
    if (!line.speaker) continue
    if (out.has(line.index)) continue
    if (line.confidence < minConfidence) continue
    /*
     * A name the cast table does not have cannot be given a voice: the voice
     * assignment is keyed on character ids. Included only once that character
     * has been created, which is what `newNames` is for.
     */
    if (line.isNew && !options.includeNew) continue

    out.set(line.index, line.speaker)
  }

  return out
}

/**
 * 每個說話的人是男是女，由他講過的句子投票決定.
 *
 * Per line rather than per speaker is what comes back, and the model can
 * disagree with itself across a long episode. The majority answer is the one
 * worth keeping; a tie leaves it unknown, which is honest — a coin flip here
 * puts somebody in the wrong voice for the whole book.
 */
export function gendersFrom(lines: readonly AttributedLine[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()

  for (const line of lines) {
    if (!line.speaker || !line.gender) continue
    const tally = votes.get(line.speaker) ?? new Map<string, number>()
    tally.set(line.gender, (tally.get(line.gender) ?? 0) + 1)
    votes.set(line.speaker, tally)
  }

  const out = new Map<string, string>()
  for (const [speaker, tally] of votes) {
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
    const [top, second] = ranked
    if (top && (!second || top[1] > second[1])) out.set(speaker, top[0])
  }

  return out
}

/** How much of the dialogue ended up with a speaker. */
export function attributionCoverage(
  plan: AttributionPlan,
  merged: Map<number, string>
): { dialogue: number; attributed: number; fromRules: number; fromModel: number } {
  const dialogue = plan.settled.length + plan.ask.length
  const fromRules = plan.settled.length

  return {
    dialogue,
    attributed: merged.size,
    fromRules,
    fromModel: Math.max(0, merged.size - fromRules),
  }
}
