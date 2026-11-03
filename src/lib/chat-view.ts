/**
 * Chat constants, with no database imports.
 *
 * The chat UI is a Client Component; importing these from `@/lib/chat` would
 * drag Drizzle into the browser bundle. Same split as `@/lib/music-view`.
 */

export const MESSAGE_KINDS = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'VOICE',
  'FILE',
  'CALL',
] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** What an attachment's MIME type means for how the bubble renders it. */
export function kindForMime(mime: string): MessageKind {
  if (mime.startsWith('image/')) return 'IMAGE'
  if (mime.startsWith('video/')) return 'VIDEO'
  if (mime.startsWith('audio/')) return 'AUDIO'
  return 'FILE'
}

/**
 * How long a connection stays open before the client reconnects.
 *
 * Vercel cuts a function at 60 seconds, and a connection killed by the
 * platform surfaces as a network error. Closing first, deliberately, keeps the
 * reconnect quiet — the browser's own EventSource retry handles it.
 */
export const STREAM_LIFETIME_MS = 50_000

/** Heartbeat interval. Must be well under `ONLINE_WINDOW_SEC`. */
export const HEARTBEAT_MS = 20_000

/** Poll interval for the fallback, when EventSource is unavailable. */
export const POLL_MS = 3_000

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/**
 * A day separator, in the studio's timezone.
 *
 * Rendering on the server would put the UTC date on a message sent at 1am in
 * Taipei, which is the previous day there.
 */
export function formatDay(date: Date): string {
  const taipei = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
  return taipei.format(date)
}

export function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatVoiceLength(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}”`
}
