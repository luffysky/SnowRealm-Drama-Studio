import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import {
  ProjectsBrowser,
  type ProjectDetailData,
} from '@/components/studio/ProjectsBrowser'
import type { ProjectCardData } from '@/components/studio/ProjectCard'
import { getSessionUser } from '@/lib/auth/session'
import { getProjectDetail, listProjects } from '@/lib/projects'

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

  const { cards, counts } = await listProjects(user.id)

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
      budgetUsd: detail.budgetUsd,
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
  spendUsd: number
  isFavourite: boolean
}): ProjectCardData {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    tags: card.tags,
    isFlagship: card.isFlagship,
    episodeCount: card.episodeCount,
    plannedEpisodes: card.plannedEpisodes,
    progress: card.progress,
    dueDate: card.dueDate?.toISOString() ?? null,
    spendUsd: card.spendUsd,
    isFavourite: card.isFavourite,
  }
}
