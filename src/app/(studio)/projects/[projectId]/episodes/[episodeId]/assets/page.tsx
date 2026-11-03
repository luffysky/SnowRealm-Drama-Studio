import { and, eq, isNull } from 'drizzle-orm'
import { Package } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/db'
import { episodes } from '@/db/schema'
import { EpisodeAssetBrowser } from '@/components/studio/EpisodeAssetBrowser'
import { episodeAssets } from '@/lib/assets'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'

export const metadata: Metadata = { title: '本集素材' }

type Params = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 本集素材 (Z2).
 *
 * The per-episode counterpart to the project-wide asset centre (81–90): the
 * same files, seen from the episode that needs them rather than from the
 * library.
 *
 * It exists because the association already did. `assets.episode_id` has been
 * written since the first upload, and until now nothing read it — so a file
 * uploaded against an episode and not yet referenced by a shot or a character
 * was invisible: stored, paid for, and impossible to find again.
 */
export default async function EpisodeAssetsPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, episodeId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [episode] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, project.id),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)

  if (!episode) notFound()

  const { groups, total, sizeBytes } = await episodeAssets(project.id, episode.id)
  const label = `EP${String(episode.number).padStart(3, '0')}`

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Package aria-hidden className="size-4 text-accent-400" />
          本集素材
        </h2>

        <p className="text-[11px] text-ink-400">
          {label}
          <span className="ml-1.5 text-ink-500">{episode.title || '未命名'}</span>
        </p>

        <nav className="ml-auto flex items-center gap-1 text-[11px]">
          <Link
            href={`/projects/${project.id}/episodes/${episode.id}/novel`}
            className="rounded-md px-2 py-1 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            小說
          </Link>
          <Link
            href={`/projects/${project.id}/episodes/${episode.id}/script`}
            className="rounded-md px-2 py-1 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            劇本
          </Link>
          <Link
            href={`/projects/${project.id}/episodes?ep=${episode.id}`}
            className="rounded-md px-2 py-1 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            集數管理
          </Link>
        </nav>
      </header>

      <EpisodeAssetBrowser
        projectId={project.id}
        episodeId={episode.id}
        groups={groups.map((group) => ({
          ...group,
          items: group.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
          })),
        }))}
        total={total}
        sizeBytes={sizeBytes}
        canUpload={can(user, 'asset.upload')}
      />
    </div>
  )
}
