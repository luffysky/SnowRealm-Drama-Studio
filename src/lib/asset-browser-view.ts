/**
 * Constants for the asset tabs, with no database imports.
 *
 * `AssetBrowser` is a Client Component; importing these from
 * `@/lib/asset-browser` would drag Drizzle and `pg` into the browser bundle and
 * fail the build with `Can't resolve 'dns'`. Same split as `@/lib/music-view`.
 */

export const ASSET_SORTS = ['recent', 'oldest', 'name', 'size', 'kind'] as const
export type AssetSort = (typeof ASSET_SORTS)[number]

export const ASSET_SORT_LABEL: Record<AssetSort, string> = {
  recent: '最新上傳',
  oldest: '最早上傳',
  name: '檔名',
  size: '檔案大小',
  kind: '類型',
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
