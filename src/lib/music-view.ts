/**
 * Music list constants and types, with no database imports.
 *
 * `MusicLibrary` is a Client Component, and importing these from
 * `@/lib/music-library` drags Drizzle and `pg` into the browser bundle — the
 * build fails with `Can't resolve 'dns'`, which names the symptom and not the
 * cause. Same split as `@/lib/search/view` and `@/lib/episode-view`.
 */

export const MUSIC_SORTS = ['recent', 'title', 'duration', 'category'] as const
export type MusicSort = (typeof MUSIC_SORTS)[number]

export const MUSIC_SORT_LABEL: Record<MusicSort, string> = {
  recent: '最近更新',
  title: '曲名',
  duration: '時長',
  category: '類型',
}

export const MUSIC_CATEGORY_LABEL: Record<string, string> = {
  OP: '片頭曲',
  ED: '片尾曲',
  BGM: 'BGM',
  INSERT: '插曲',
  CHARACTER_SONG: '角色曲',
  OTHER: '其他',
}

export const MUSIC_CATEGORY_ORDER = ['OP', 'ED', 'BGM', 'INSERT', 'CHARACTER_SONG', 'OTHER']

export const LICENSE_LABEL: Record<string, string> = {
  PENDING_REVIEW: '待確認',
  APPROVED: '已授權',
  RESTRICTED: '受限制',
  EXPIRED: '已過期',
  REJECTED: '已拒絕',
}

export const LICENSE_STYLE: Record<string, string> = {
  PENDING_REVIEW: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  RESTRICTED: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  EXPIRED: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  REJECTED: 'bg-stage-800 text-ink-500 ring-stage-700',
}
