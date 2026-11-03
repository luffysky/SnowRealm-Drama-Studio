import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AssetCenterNav } from '@/components/assets/AssetCenterNav'
import { MusicLibrary } from '@/components/assets/MusicLibrary'
import { getAssetCenter } from '@/lib/asset-center'
import { getSessionUser } from '@/lib/auth/session'
import { listMusic, MUSIC_SORTS, type MusicSort } from '@/lib/music-library'
import { requireProjectPage } from '@/lib/project-access'

export const metadata: Metadata = { title: '音樂素材庫' }

type Params = {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Reads one query parameter, ignoring the repeated form. */
function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 82 音樂素材庫 (Z5).
 *
 * All of the list state comes from the URL, which is what makes a refresh and
 * a shared link behave the same — spec §2-82's「搜尋/分頁重整仍有效」.
 */
export default async function MusicLibraryPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const sp = await searchParams
  const sortParam = one(sp.sort) as MusicSort
  const sort = MUSIC_SORTS.includes(sortParam) ? sortParam : 'recent'
  const view = one(sp.view) === 'card' ? 'card' : 'list'

  const query = {
    q: one(sp.q),
    category: one(sp.category),
    mood: one(sp.mood),
    genre: one(sp.genre),
    license: one(sp.license),
    sort,
    page: Number(one(sp.page)) || 1,
  }

  const [result, centre] = await Promise.all([
    listMusic(project.id, query),
    getAssetCenter(project.id),
  ])

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <AssetCenterNav
        projectId={project.id}
        counts={Object.fromEntries(centre.byKind.map((row) => [row.kind, row.count]))}
      />

      <MusicLibrary
        projectId={project.id}
        rows={result.rows.map((row) => ({
          ...row,
          updatedAt: row.updatedAt.toISOString(),
        }))}
        matched={result.matched}
        page={result.page}
        pageCount={result.pageCount}
        categoryCounts={result.categoryCounts}
        availableGenres={result.availableGenres}
        availableMoods={result.availableMoods}
        query={{ ...query, view }}
      />
    </div>
  )
}
