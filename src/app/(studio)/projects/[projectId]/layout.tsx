import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { ProjectWorkspaceChrome } from '@/components/studio/ProjectWorkspaceChrome'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE } from '@/lib/constants'
import { requireProjectPage } from '@/lib/project-access'
import { listProjects } from '@/lib/projects'

/**
 * The project workspace (`docs/ROUTES.md` §3).
 *
 * Everything scoped to one project renders inside this layout, so the header,
 * the tab strip and the project switcher are defined once rather than redrawn
 * by each page.
 *
 * The permission check here is for the *page* — it decides whether a 404 is
 * rendered instead of the workspace. It is **not** the security boundary: a
 * layout does not re-run for Route Handlers, so every API route and every data
 * function performs its own check (§5). This one exists so a member never sees
 * the chrome of a project they cannot open.
 */
export default async function ProjectWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ projectId: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // From the URL, never from stored state (§4): a deep link, a refresh and two
  // browser tabs on different projects must all work.
  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  // The switcher only offers projects this member may actually open.
  const { cards } = await listProjects(user.id)

  return (
    <div className="flex min-h-full flex-col">
      <ProjectWorkspaceChrome
        project={{
          id: project.id,
          title: project.title,
          novelTitle: project.novelTitle,
          dramaTitle: project.dramaTitle,
          isFlagship: project.isFlagship,
          coverAssetId: project.coverAssetId,
        }}
        siblings={cards.map((card) => ({
          id: card.id,
          title: card.title,
          isFlagship: card.isFlagship,
          coverAssetId: card.coverAssetId,
          summary: `${PROJECT_STATUS_LABEL[card.status]} · ${
            card.episodeCount > 0
              ? `${card.episodeCount} 集`
              : card.plannedEpisodes > 0
                ? `暫定 ${card.plannedEpisodes} 集`
                : '尚未規劃集數'
          }`,
        }))}
        statusLabel={PROJECT_STATUS_LABEL[project.status]}
        statusClassName={PROJECT_STATUS_STYLE[project.status]}
        tags={project.tags}
        logline={project.logline}
        settings={{
          id: project.id,
          title: project.title,
          novelTitle: project.novelTitle,
          dramaTitle: project.dramaTitle,
          logline: project.logline,
          synopsis: project.synopsis,
          tags: project.tags,
          status: project.status,
          targetMinSec: project.targetMinSec,
          targetMaxSec: project.targetMaxSec,
          targetChars: project.targetChars,
          coverAssetId: project.coverAssetId,
          novelCoverAssetId: project.novelCoverAssetId,
        }}
        canWrite={can(user, 'project.write')}
      />

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
