import clsx, { type ClassValue } from 'clsx'

/** Tailwind class composer. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

/** 150 -> "2:30". Used wherever a runtime is shown. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** 150 -> "2 分 30 秒"; 45 -> "45 秒". */
export function formatDurationZh(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  if (minutes === 0) return `${seconds} 秒`
  if (seconds === 0) return `${minutes} 分`
  return `${minutes} 分 ${seconds} 秒`
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/**
 * Counts characters the way a Chinese writer counts them: CJK and Latin
 * characters each count 1, whitespace is excluded.
 */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * Characters a human would count, from rich-text HTML.
 *
 * Block tags become a space before stripping, so `<p>甲</p><p>乙</p>` does not
 * collapse into one run; entities are decoded for the handful that actually
 * appear, because counting `&amp;` as five characters would be wrong in the
 * same way counting `<strong>` as eight is.
 *
 * Used on the server, where there is no DOM. The browser has `countHtmlChars`
 * in `src/components/editor/extensions.ts`, which parses properly.
 */
export function countRichTextChars(html: string): number {
  const text = html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|hr)[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")

  return text.replace(/\s/g, '').length
}

/**
 * Rough runtime estimate for a script, in seconds. Dialogue is read at roughly
 * 5 characters per second; action lines add time for what happens on screen
 * even though nothing is spoken (spec 07「片長估計須計入動作與停頓」).
 */
export function estimateScriptSeconds(input: {
  dialogueChars: number
  actionChars: number
  shotCount?: number
}): number {
  const dialogueSec = input.dialogueChars / 5
  const actionSec = input.actionChars / 12
  // Each cut costs a beat of screen time.
  const cutSec = (input.shotCount ?? 0) * 0.3
  return Math.round(dialogueSec + actionSec + cutSec)
}

export type DurationVerdict = 'under' | 'ok' | 'over'

/** Compares a storyboard's total against the episode target range. */
export function judgeDuration(
  totalSec: number,
  minSec: number,
  maxSec: number
): { verdict: DurationVerdict; deltaSec: number } {
  if (totalSec < minSec) return { verdict: 'under', deltaSec: totalSec - minSec }
  if (totalSec > maxSec) return { verdict: 'over', deltaSec: totalSec - maxSec }
  return { verdict: 'ok', deltaSec: 0 }
}

/** Fraction 0..1 of an episode's nine stages that are DONE. */
export function stageCompletion(states: { state: string }[]): number {
  if (states.length === 0) return 0
  const done = states.filter((s) => s.state === 'DONE').length
  return done / states.length
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** URL-safe slug that keeps CJK characters readable. */
export function slugify(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || 'untitled'
}

/** Relative time in Traditional Chinese, for activity feeds. */
export function formatRelativeZh(date: Date | string, now: Date = new Date()): string {
  const then = typeof date === 'string' ? new Date(date) : date
  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000)

  if (diffSec < 0) return '剛剛'
  if (diffSec < 60) return '剛剛'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} 小時前`
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86_400)} 天前`

  return then.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** Groups an array by a derived key, preserving insertion order. */
export function groupBy<T, K extends string | number>(
  items: readonly T[],
  keyOf: (item: T) => K
): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = out.get(key)
    if (bucket) bucket.push(item)
    else out.set(key, [item])
  }
  return out
}

/** Clamps a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Rich text as a reader sees it: markup gone, paragraph breaks kept.
 *
 * Block-level tags become newlines before the rest are stripped, so
 * `<p>a</p><p>b</p>` does not silently become "ab" — which matters when the
 * result is handed to a model as prose to continue from.
 */
export function stripHtmlToText(html: string): string {
  if (!html) return ''

  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
