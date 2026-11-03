import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { ProjectStatusValue } from '@/lib/constants'

/**
 * The one place that decides whether a member may work on a project.
 *
 * `docs/ROUTES.md` §5: navigation is a convenience, not a permission. Every
 * read and write is scoped by projectId on the server, and a layout check does
 * not count — a layout does not re-run for a Route Handler, so an API call with
 * a hand-typed projectId would sail straight past it.
 *
 * Today both members may see every project that is not soft-deleted. That rule
 * lives here rather than being repeated in each query, so narrowing it later is
 * one edit instead of a hunt.
 */

export type ProjectAccess = {
  id: string
  title: string
  slug: string
  status: ProjectStatusValue
  tags: string[]
  isFlagship: boolean
}

/**
 * Postgres rejects a malformed uuid with an error rather than an empty result,
 * so `/projects/garbage` would 500 instead of 404 if the id reached SQL.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * The visibility rule, as a condition other queries can reuse.
 *
 * `userId` is unused for now and deliberately kept in the signature: when
 * per-project membership arrives, every caller already passes what the new
 * rule will need.
 */
export function visibleProjects(_userId: string): SQL | undefined {
  return isNull(projects.deletedAt)
}

/**
 * Returns the project, or null when it does not exist, is soft-deleted, or
 * this member may not see it.
 *
 * The three are deliberately indistinguishable: answering "exists but
 * forbidden" differently from "no such project" lets anyone enumerate what
 * exists by probing ids.
 */
export async function findAccessibleProject(
  projectId: string,
  userId: string
): Promise<ProjectAccess | null> {
  if (!isProjectId(projectId)) return null

  const [row] = await db
    .select({
      id: projects.id,
      title: projects.title,
      slug: projects.slug,
      status: projects.status,
      tags: projects.tags,
      isFlagship: projects.isFlagship,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), visibleProjects(userId)))
    .limit(1)

  return row ?? null
}

/** Server Component / layout form: renders the 404 page. */
export async function requireProjectPage(
  projectId: string,
  userId: string
): Promise<ProjectAccess> {
  const project = await findAccessibleProject(projectId, userId)
  if (!project) notFound()
  return project
}

/**
 * API form: throws a 404 ApiError.
 *
 * Route Handlers must call this themselves. They do not inherit the layout's
 * check, and an attacker reaches them directly with fetch.
 */
export async function requireProjectApi(
  projectId: string,
  userId: string
): Promise<ProjectAccess> {
  const project = await findAccessibleProject(projectId, userId)
  if (!project) throw new ApiError(404, '找不到這個作品', 'project_not_found')
  return project
}
