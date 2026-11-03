import type { AssetKindValue } from '@/lib/constants'

/**
 * The asset centre's tabs (designs 81–90), with no database imports.
 *
 * Shared because two things need the same answer and must not disagree: the
 * tab strip decides which tabs are links, and the uploader decides where to
 * send you after a file lands. When those were separate, an upload could route
 * to a tab the strip knows is not built yet.
 *
 * Same client/server split as `@/lib/music-view` — `AssetCenterNav` and
 * `AssetUploadButton` are Client Components, and anything reaching
 * `@/lib/asset-center` would drag Drizzle into the browser bundle.
 */

export type AssetTab = {
  key: string
  label: string
  /** Path segment under `/projects/[id]/assets`. Empty means the overview. */
  segment: string
  /** False renders the tab disabled; spec v2 §4 forbids a link to a 404. */
  ready: boolean
  milestone?: string
  /** The asset kinds that belong in this tab, for routing after an upload. */
  kinds?: AssetKindValue[]
}

export const ASSET_TABS: AssetTab[] = [
  { key: 'overview', label: '資產總覽', segment: '', ready: true },
  { key: 'all', label: '全部素材', segment: 'all', ready: true },
  {
    key: 'image',
    label: '圖片',
    segment: 'image',
    ready: true,
    kinds: ['IMAGE', 'STICKER'],
  },
  { key: 'video', label: '影片', segment: 'video', ready: true, kinds: ['VIDEO'] },
  { key: 'music', label: '音樂', segment: 'music', ready: true, kinds: ['MUSIC'] },
  { key: 'sfx', label: '音效', segment: 'sfx', ready: true, kinds: ['SFX'] },
  { key: 'voice', label: '配音', segment: 'voice', ready: true, kinds: ['VOICE'] },
  {
    key: 'docs',
    label: '文件',
    segment: 'docs',
    ready: true,
    // Must match what the docs tab lists, or the badge counts fewer files
    // than the page shows.
    kinds: ['DOC', 'NOVEL_ATTACHMENT', 'OTHER'],
  },
  { key: 'licenses', label: '授權管理', segment: 'licenses', ready: false, milestone: 'M3' },
]

/** The tab a freshly uploaded asset of this kind belongs in, built or not. */
export function tabForKind(kind: AssetKindValue): AssetTab | null {
  return ASSET_TABS.find((tab) => tab.kinds?.includes(kind)) ?? null
}

export function assetTabHref(projectId: string, tab: AssetTab): string {
  const base = `/projects/${projectId}/assets`
  return tab.segment ? `${base}/${tab.segment}` : base
}
