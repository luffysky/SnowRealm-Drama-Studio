import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AssetBrowser, type AssetItem } from '@/components/assets/AssetBrowser'
import { AssetCenterNav } from '@/components/assets/AssetCenterNav'
import { listAssets } from '@/lib/asset-browser'
import { ASSET_SORTS, type AssetSort } from '@/lib/asset-browser-view'
import { getSessionUser } from '@/lib/auth/session'
import type { AssetKindValue } from '@/lib/constants'
import { requireProjectPage } from '@/lib/project-access'

/**
 * The per-kind asset tabs (81, 86, 87 and 全部素材).
 *
 * One dynamic segment rather than six near-identical folders. `music` stays a
 * static folder beside this one — Next.js prefers the literal segment, so
 * `/assets/music` keeps its own page, its `new` form and its `[assetId]`
 * player, all of which need the audio metadata this generic list does not join.
 *
 * `licenses` is deliberately not handled here and 404s: it is Z8, and a tab
 * that silently rendered an empty file list would read as "there are no
 * licences" rather than "this is not built".
 */

const TABS: Record<
  string,
  { heading: string; kinds: AssetKindValue[]; uploadKind?: AssetKindValue }
> = {
  all: { heading: '全部素材', kinds: [] },
  image: { heading: '圖片素材庫', kinds: ['IMAGE', 'STICKER'], uploadKind: 'IMAGE' },
  video: { heading: '影片素材庫', kinds: ['VIDEO'], uploadKind: 'VIDEO' },
  sfx: { heading: '音效素材庫', kinds: ['SFX'], uploadKind: 'SFX' },
  voice: { heading: '配音素材庫', kinds: ['VOICE'], uploadKind: 'VOICE' },
  docs: {
    heading: '文件素材庫',
    kinds: ['DOC', 'NOVEL_ATTACHMENT', 'OTHER'],
    uploadKind: 'DOC',
  },
}

type Params = {
  params: Promise<{ projectId: string; tab: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tab } = await params
  return { title: TABS[tab]?.heading ?? '素材資產中心' }
}

export default async function AssetTabPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, tab } = await params
  const config = TABS[tab]
  if (!config) notFound()

  const project = await requireProjectPage(projectId, user.id)
  const query = await searchParams

  const first = (key: string): string | undefined => {
    const value = query[key]
    return Array.isArray(value) ? value[0] : value
  }

  const sortParam = first('sort')
  const pageParam = Number(first('page'))

  const result = await listAssets(project.id, config.kinds, {
    ...(first('q') ? { q: first('q') as string } : {}),
    ...(first('episode') ? { episodeId: first('episode') as string } : {}),
    ...(sortParam && (ASSET_SORTS as readonly string[]).includes(sortParam)
      ? { sort: sortParam as AssetSort }
      : {}),
    ...(Number.isFinite(pageParam) && pageParam > 0 ? { page: pageParam } : {}),
  })

  /*
   * Dates are serialised for the Client Component boundary. Passing a Date
   * works in dev and throws in a production build; sending strings makes the
   * boundary explicit instead of relying on that.
   */
  const rows: AssetItem[] = result.rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <AssetCenterNav projectId={project.id} counts={result.kindCounts} />

      <AssetBrowser
        projectId={project.id}
        heading={config.heading}
        kinds={config.kinds}
        {...(config.uploadKind ? { uploadKind: config.uploadKind } : {})}
        rows={rows}
        matched={result.matched}
        page={result.page}
        pageCount={result.pageCount}
        kindCounts={result.kindCounts}
        totalBytes={result.totalBytes}
        episodeOptions={result.episodeOptions}
      />
    </div>
  )
}
