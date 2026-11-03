import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EpisodeManager } from '@/components/studio/EpisodeManager'
import { getSessionUser } from '@/lib/auth/session'
import { EPISODE_STATUSES, type EpisodeStatusValue } from '@/lib/constants'
import {
  getEpisodeDetail,
  listEpisodes,
  parsePerPage,
  parseSort,
  parseView,
  type EpisodeRow,
} from '@/lib/episodes'
import { requireProjectPage } from '@/lib/project-access'
import { PRODUCTION_STAGE_KEYS, type ProductionStageKey } from '@/lib/production'

export const metadata: Metadata = { title: '集數管理' }

type Params = {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** First value only: `?page=2&page=3` must not become "2,3". */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

/**
 * 集數管理 (design 05).
 *
 * Paging, search and filtering run in SQL and are driven entirely by the query
 * string, so a deep link, a refresh and a second browser tab all show the same
 * thing (`docs/ROUTES.md` §4). Nothing about "which project" or "which page"
 * is remembered anywhere else.
 */
export default async function EpisodesPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  // The layout checked too, but a page must not depend on that: a layout does
  // not re-run for every entry point.
  const project = await requireProjectPage(projectId, user.id)

  const sp = await searchParams
  const statusParam = one(sp.status)
  const stageParam = one(sp.stage)

  const status = (EPISODE_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as EpisodeStatusValue)
    : undefined
  const stage = (PRODUCTION_STAGE_KEYS as readonly string[]).includes(stageParam)
    ? (stageParam as ProductionStageKey)
    : undefined

  const result = await listEpisodes(project.id, {
    page: Number(one(sp.page)) || 1,
    perPage: parsePerPage(one(sp.per)),
    search: one(sp.q),
    status,
    stage,
    sort: parseSort(one(sp.sort)),
  })

  // The selected episode may be off the current page; look it up by id rather
  // than assuming it is in `rows`.
  const selectedId = one(sp.ep)
  const selected = selectedId
    ? await getEpisodeDetail(project.id, selectedId)
    : (result.rows[0] ?? null)

  return (
    <EpisodeManager
      projectId={project.id}
      result={{ ...result, rows: result.rows.map(serialise) }}
      selected={selected ? serialise(selected) : null}
      view={parseView(one(sp.view))}
      search={one(sp.q)}
      status={status ?? ''}
      stage={stage ?? ''}
      sort={parseSort(one(sp.sort))}
    />
  )
}

/** Dates cannot cross into a Client Component. */
function serialise(row: EpisodeRow) {
  return {
    ...row,
    dueDate: row.dueDate?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}
