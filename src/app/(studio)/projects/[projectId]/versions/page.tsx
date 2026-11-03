import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { VersionBrowser } from '@/components/studio/VersionBrowser'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getVersion, listVersions, snapshotText, versionStats } from '@/lib/versions'

export const metadata: Metadata = { title: '版本紀錄' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 08 版本紀錄.
 *
 * Snapshots are flattened to text on the server. The diff must compare prose,
 * not markup — otherwise a changed class attribute reads as a rewritten line.
 */
export default async function VersionsPage({ params }: Params) {
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

  return (
    <VersionBrowser
      projectId={project.id}
      versions={withText}
      stats={{ ...stats, lastUpdatedAt: stats.lastUpdatedAt?.toISOString() ?? null }}
    />
  )
}
