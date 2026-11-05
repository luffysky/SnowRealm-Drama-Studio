import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { VersionBrowser } from '@/components/studio/VersionBrowser'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getVersion, listVersions, snapshotText, versionStats } from '@/lib/versions'

export const metadata: Metadata = { title: '版本紀錄' }

type Params = {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * 08 版本紀錄.
 *
 * Snapshots are flattened to text on the server. The diff must compare prose,
 * not markup — otherwise a changed class attribute reads as a rewritten line.
 */
export default async function VersionsPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [rows, stats] = await Promise.all([
    listVersions(project.id),
    versionStats(project.id),
  ])

  // The snapshot text is only needed for the versions actually shown.
  const withText = await Promise.all(
    rows.slice(0, 60).map(async (row) => {
      const full = await getVersion(project.id, row.id)
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        text: full ? snapshotText(full.snapshot) : '',
      }
    })
  )

  /*
   * `?ep=EP007` 從集數詳情帶進來 (Z163)。一進來就預選那一集最新的兩版，
   * 不用在一百多筆裡自己翻。
   */
  const sp = await searchParams
  const ep = (Array.isArray(sp.ep) ? sp.ep[0] : sp.ep)?.trim() ?? ''

  return (
    <VersionBrowser
      projectId={project.id}
      versions={withText}
      defaultSearch={ep}
      stats={{ ...stats, lastUpdatedAt: stats.lastUpdatedAt?.toISOString() ?? null }}
    />
  )
}
