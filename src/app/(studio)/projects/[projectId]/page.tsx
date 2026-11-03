import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ProjectOverview } from '@/components/studio/ProjectOverview'
import { getSessionUser } from '@/lib/auth/session'
import { getProjectOverview } from '@/lib/project-overview'
import { getFxRates } from '@/lib/settings'

type Params = { params: Promise<{ projectId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await getSessionUser()
  if (!user) return { title: '作品總覽' }

  const { projectId } = await params
  const project = await getProjectOverview(projectId, user.id)
  return { title: project ? `${project.title}｜作品總覽` : '作品總覽' }
}

/**
 * 作品總覽 (design 04).
 *
 * Everything the page shows is derived on read, so there is nothing to cache
 * and no revalidation window to get wrong: the session makes it dynamic
 * anyway.
 */
export default async function ProjectOverviewPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const [project, fx] = await Promise.all([
    getProjectOverview(projectId, user.id),
    getFxRates(),
  ])
  if (!project) notFound()

  return <ProjectOverview project={project} currency={user.displayCurrency} fx={fx} />
}
