import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import {
  ProjectsBrowser,
  type ProjectDetailData,
} from '@/components/studio/ProjectsBrowser'
import type { ProjectCardData } from '@/components/studio/ProjectCard'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { getProjectDetail, listProjects } from '@/lib/projects'
import { getFxRates } from '@/lib/settings'

export const metadata: Metadata = { title: '作品列表' }

/**
 * 作品列表 (design 03).
 *
 * Loads every project plus its detail in one pass: with two members and a
 * handful of shows the whole catalogue is small, and prefetching the rail means
 * selecting a card is instant rather than a round-trip.
 *
 * Dates are serialised to ISO strings because they cross into a Client
 * Component, which cannot receive `Date` instances.
 */
export default async function ProjectsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [{ cards, counts }, fx] = await Promise.all([listProjects(user.id), getFxRates()])

  const details: Record<string, ProjectDetailData> = {}
  for (const card of cards) {
    const detail = await getProjectDetail(card.id, user.id)
    if (!detail) continue

    details[card.id] = {
      ...toCardData(detail),
      slug: detail.slug,
      logline: detail.logline,
      ownerName: detail.ownerName,
      techLeadName: detail.techLeadName,
      startDate: detail.startDate?.toISOString() ?? null,
      budget: detail.budget,
      doneEpisodes: detail.doneEpisodes,
      arcs: detail.arcs,
      recentActivity: detail.recentActivity.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
    }
  }

  return (
    <ProjectsBrowser
      projects={cards.map(toCardData)}
      details={details}
      counts={counts}
      currency={user.displayCurrency}
      fx={fx}
      canCreate={can(user, 'project.write')}
    />
  )
}

function toCardData(card: {
  id: string
  title: string
  status: ProjectCardData['status']
  tags: string[]
  isFlagship: boolean
  episodeCount: number
  plannedEpisodes: number
  progress: number
  dueDate: Date | null
  spend: number
  isFavourite: boolean
  coverAssetId: string | null
  novelTitle: string
  dramaTitle: string
}): ProjectCardData {
  return {
    id: card.id,
    title: card.title,
    novelTitle: card.novelTitle,
    dramaTitle: card.dramaTitle,
    status: card.status,
    tags: card.tags,
    isFlagship: card.isFlagship,
    episodeCount: card.episodeCount,
    plannedEpisodes: card.plannedEpisodes,
    progress: card.progress,
    dueDate: card.dueDate?.toISOString() ?? null,
    spend: card.spend,
    isFavourite: card.isFavourite,
    coverAssetId: card.coverAssetId,
  }
}
