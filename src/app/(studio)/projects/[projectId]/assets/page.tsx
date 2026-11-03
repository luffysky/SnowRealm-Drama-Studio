import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AssetCenterOverview } from '@/components/assets/AssetCenterOverview'
import { getAssetCenter } from '@/lib/asset-center'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getFxRates } from '@/lib/settings'

export const metadata: Metadata = { title: '素材資產中心' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 81 素材資產中心總覽 (Z4).
 *
 * Everything shown is counted on read. There is nothing cached and no
 * revalidation window to get wrong — the session makes the page dynamic
 * anyway, and a stale asset count is the kind of wrong number nobody notices
 * until it matters.
 */
export default async function AssetCenterPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [data, fx] = await Promise.all([getAssetCenter(project.id), getFxRates()])

  return (
    <AssetCenterOverview
      projectId={project.id}
      data={data}
      currency={user.displayCurrency}
      fx={fx}
    />
  )
}
