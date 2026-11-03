import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { WorldBrowser } from '@/components/studio/WorldBrowser'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getWorld } from '@/lib/world'

export const metadata: Metadata = { title: '世界觀設定' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 09 世界觀設定.
 *
 * spec v3 §09 covers 王朝、地圖、商路、制度、穿越規則、伏筆 — and says plainly
 * not to change story canon from the reference art. Nothing here is seeded:
 * 《一灶見山河》's dynasty name and the 120-episode canon are still undecided,
 * so the page opens empty and says why.
 */
export default async function WorldPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const world = await getWorld(project.id)

  return (
    <WorldBrowser
      projectId={project.id}
      entries={world.entries.map((entry) => ({
        ...entry,
        updatedAt: entry.updatedAt.toISOString(),
      }))}
      events={world.events.map((event) => ({
        id: event.id,
        scope: event.scope,
        title: event.title,
        description: event.description,
        eraLabel: event.eraLabel,
        inUniverseOrder: event.inUniverseOrder,
        revealedInEpisode: event.revealedInEpisode,
        isCanon: event.isCanon,
      }))}
      countsByCategory={world.countsByCategory}
      totalEntries={world.totalEntries}
      canonEntries={world.canonEntries}
    />
  )
}
