import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { AI_JOB_KIND_LABEL, type AiJobKindValue } from '@/lib/constants'

/**
 * 製片中心真正該回答的問題 (Z127).
 *
 * 「AI 製片中心只是一堆排程那沒必要特別做」 — and that was right. A list of
 * rows with statuses is a database client with rounded corners. What a
 * production centre is for is the questions you cannot answer by looking at
 * any single row:
 *
 *  1. **錢** — what has this cost, is the estimate honest, and what does 120
 *     episodes come to at this rate.
 *  2. **產能** — how long each kind of task takes, how often it fails, which
 *     model is worth its price.
 *  3. **待確認** — output sitting in `AWAITING_REVIEW` that nobody has looked
 *     at. Two outlines had been waiting a day with no screen that listed them.
 *  4. **對不上的地方** — mismatches between what has been written and what the
 *     settings say it should be.
 *
 * Every number here is read from `ai_jobs` and the content tables. Nothing is
 * seeded, assumed or rounded up to look better (spec v3 §0): a kind with no
 * finished job reports nothing rather than a zero that reads like free.
 */

/* -------------------------------------------------------------------------- */
/* 1. 錢                                                                      */
/* -------------------------------------------------------------------------- */

export type SpendWindow = {
  key: 'today' | 'week' | 'month' | 'all'
  label: string
  /** Jobs that finished in the window and reported a cost. */
  jobs: number
  spent: number
  /** What those same jobs were estimated at, for the accuracy readout. */
  estimated: number
}

export type KindSpend = {
  kind: AiJobKindValue
  label: string
  jobs: number
  spent: number
  avgSpent: number
  /** Sum of estimates for the jobs that have both numbers. */
  estimated: number
  /**
   * actual ÷ estimated over jobs carrying both. 1.0 is a perfect estimate,
   * below 1 means the dialog over-quoted, above 1 means it under-quoted —
   * which is the direction worth knowing about.
   */
  accuracy: number | null
  comparable: number
}

export type Projection = {
  projectId: string
  projectTitle: string
  kind: AiJobKindValue
  label: string
  avgPerEpisode: number
  episodesTotal: number
  episodesDone: number
  remaining: number
  projected: number
}

export type SpendSummary = {
  windows: SpendWindow[]
  byKind: KindSpend[]
  projections: Projection[]
  /** Across everything with both numbers. Null when nothing can be compared. */
  overallAccuracy: number | null
}

const WINDOW_LABEL: Record<string, string> = {
  today: '今天',
  week: '近 7 天',
  month: '近 30 天',
  all: '全部',
}

export async function spendSummary(): Promise<SpendSummary> {
  /*
   * Windows are measured in Asia/Taipei, not UTC. 「今天花了多少」 asked at
   * 兩點 should not still be answering for yesterday, which is what a UTC day
   * boundary does for eight hours of every Taipei day.
   */
  const windows = await db.execute<{
    key: string
    jobs: string
    spent: string
    estimated: string
  }>(sql`
    with scoped as (
      select actual_cost, estimated_cost, finished_at
        from ai_jobs
       where actual_cost is not null
    )
    select 'today' as key, count(*)::text as jobs,
           coalesce(sum(actual_cost), 0)::text as spent,
           coalesce(sum(estimated_cost), 0)::text as estimated
      from scoped
     where (finished_at at time zone 'Asia/Taipei')::date
         = (now() at time zone 'Asia/Taipei')::date
    union all
    select 'week', count(*)::text,
           coalesce(sum(actual_cost), 0)::text, coalesce(sum(estimated_cost), 0)::text
      from scoped where finished_at >= now() - interval '7 days'
    union all
    select 'month', count(*)::text,
           coalesce(sum(actual_cost), 0)::text, coalesce(sum(estimated_cost), 0)::text
      from scoped where finished_at >= now() - interval '30 days'
    union all
    select 'all', count(*)::text,
           coalesce(sum(actual_cost), 0)::text, coalesce(sum(estimated_cost), 0)::text
      from scoped
  `)

  const byKindRows = await db.execute<{
    kind: string
    jobs: string
    spent: string
    estimated: string
    comparable: string
  }>(sql`
    select kind,
           count(*)::text as jobs,
           coalesce(sum(actual_cost), 0)::text as spent,
           /*
            * Only the jobs carrying both numbers feed the accuracy ratio.
            * Summing every estimate against every actual would compare a run
            * that was never estimated with one that was.
            */
           coalesce(sum(estimated_cost) filter (where estimated_cost is not null), 0)::text
             as estimated,
           count(*) filter (where estimated_cost is not null)::text as comparable
      from ai_jobs
     where actual_cost is not null
     group by kind
     order by sum(actual_cost) desc
  `)

  const labelOf = (kind: string) => AI_JOB_KIND_LABEL[kind as AiJobKindValue] ?? kind

  const byKind: KindSpend[] = byKindRows.rows.map((row) => {
    const jobs = Number(row.jobs)
    const spent = Number(row.spent)
    const estimated = Number(row.estimated)
    const comparable = Number(row.comparable)

    return {
      kind: row.kind as AiJobKindValue,
      label: labelOf(row.kind),
      jobs,
      spent,
      avgSpent: jobs > 0 ? spent / jobs : 0,
      estimated,
      accuracy: comparable > 0 && estimated > 0 ? spent / estimated : null,
      comparable,
    }
  })

  /*
   * 「照這個速度 120 集要多少錢」.
   *
   * Per project and per kind, because the average cost of turning one episode
   * into a script says nothing about the cost of a storyboard, and a second
   * work with a different episode length has a different average.
   *
   * `episodes_done` counts **distinct episodes** that already have a finished
   * job of that kind, not jobs: three attempts at EP001 is one episode done,
   * and counting it as three would under-state what is left.
   */
  const projectionRows = await db.execute<{
    project_id: string
    project_title: string
    kind: string
    avg_cost: string
    episodes_done: string
    episodes_total: string
  }>(sql`
    with done as (
      select j.project_id, j.kind, j.episode_id, avg(j.actual_cost) as cost
        from ai_jobs j
       where j.actual_cost is not null
         and j.project_id is not null
         and j.episode_id is not null
         and j.status in ('SUCCEEDED', 'AWAITING_REVIEW')
       group by j.project_id, j.kind, j.episode_id
    ),
    totals as (
      select project_id, count(*)::int as episodes_total
        from episodes where deleted_at is null group by project_id
    )
    select d.project_id::text as project_id,
           p.title as project_title,
           d.kind,
           avg(d.cost)::text as avg_cost,
           count(*)::text as episodes_done,
           coalesce(t.episodes_total, 0)::text as episodes_total
      from done d
      join projects p on p.id = d.project_id
      left join totals t on t.project_id = d.project_id
     group by d.project_id, p.title, d.kind, t.episodes_total
     order by p.title, d.kind
  `)

  const projections: Projection[] = projectionRows.rows.map((row) => {
    const avgPerEpisode = Number(row.avg_cost)
    const episodesTotal = Number(row.episodes_total)
    const episodesDone = Number(row.episodes_done)
    const remaining = Math.max(0, episodesTotal - episodesDone)

    return {
      projectId: row.project_id,
      projectTitle: row.project_title,
      kind: row.kind as AiJobKindValue,
      label: labelOf(row.kind),
      avgPerEpisode,
      episodesTotal,
      episodesDone,
      remaining,
      projected: avgPerEpisode * remaining,
    }
  })

  const comparableSpend = byKind.reduce((n, row) => n + (row.comparable > 0 ? row.spent : 0), 0)
  const comparableEstimate = byKind.reduce((n, row) => n + row.estimated, 0)

  return {
    windows: windows.rows.map((row) => ({
      key: row.key as SpendWindow['key'],
      label: WINDOW_LABEL[row.key] ?? row.key,
      jobs: Number(row.jobs),
      spent: Number(row.spent),
      estimated: Number(row.estimated),
    })),
    byKind,
    projections,
    overallAccuracy: comparableEstimate > 0 ? comparableSpend / comparableEstimate : null,
  }
}

/* -------------------------------------------------------------------------- */
/* 2. 產能                                                                    */
/* -------------------------------------------------------------------------- */

export type ThroughputRow = {
  /** Kind key, or a model id when grouped by model. */
  key: string
  label: string
  attempts: number
  produced: number
  failed: number
  cancelled: number
  /** produced ÷ (produced + failed). A cancelled run is nobody's failure. */
  successRate: number | null
  medianSec: number | null
  slowestSec: number | null
  avgCost: number | null
}

/**
 * How long things take and how often they work.
 *
 * Median rather than mean for duration: one job that hit a retry drags a mean
 * far away from what the next run will actually feel like.
 *
 * 「成功」 counts `AWAITING_REVIEW` as well as `SUCCEEDED`. The model did its
 * job when it produced output; whether a person has got round to accepting it
 * is question 3, not a measure of the provider.
 */
export async function throughput(): Promise<{
  byKind: ThroughputRow[]
  byModel: ThroughputRow[]
}> {
  const group = async (column: 'kind' | 'model') => {
    const rows = await db.execute<{
      key: string
      attempts: string
      produced: string
      failed: string
      cancelled: string
      median_sec: string | null
      slowest_sec: string | null
      avg_cost: string | null
    }>(sql`
      select ${sql.raw(column)}::text as key,
             count(*)::text as attempts,
             count(*) filter (where status in ('SUCCEEDED', 'AWAITING_REVIEW'))::text as produced,
             count(*) filter (where status = 'FAILED')::text as failed,
             count(*) filter (where status = 'CANCELLED')::text as cancelled,
             (percentile_cont(0.5) within group (
               order by extract(epoch from (finished_at - started_at))
             ) filter (where started_at is not null and finished_at is not null))::text
               as median_sec,
             (max(extract(epoch from (finished_at - started_at)))
               filter (where started_at is not null and finished_at is not null))::text
               as slowest_sec,
             (avg(actual_cost) filter (where actual_cost is not null))::text as avg_cost
        from ai_jobs
       -- Cast before comparing: kind is an enum, and enum <> '' is not a
       -- wrong answer, it is a 22P02 from the enum parser. Only model can
       -- actually be blank (a job that never reached a provider), so this
       -- drops those from the model table without a second query.
       where ${sql.raw(column)}::text <> ''
         and status in ('SUCCEEDED', 'AWAITING_REVIEW', 'FAILED', 'CANCELLED')
       group by ${sql.raw(column)}
       order by count(*) desc
    `)

    return rows.rows.map((row): ThroughputRow => {
      const produced = Number(row.produced)
      const failed = Number(row.failed)
      const decided = produced + failed

      return {
        key: row.key,
        label:
          column === 'kind' ? (AI_JOB_KIND_LABEL[row.key as AiJobKindValue] ?? row.key) : row.key,
        attempts: Number(row.attempts),
        produced,
        failed,
        cancelled: Number(row.cancelled),
        successRate: decided > 0 ? produced / decided : null,
        medianSec: row.median_sec === null ? null : Number(row.median_sec),
        slowestSec: row.slowest_sec === null ? null : Number(row.slowest_sec),
        avgCost: row.avg_cost === null ? null : Number(row.avg_cost),
      }
    })
  }

  const [byKind, byModel] = await Promise.all([group('kind'), group('model')])
  return { byKind, byModel }
}

/* -------------------------------------------------------------------------- */
/* 3. 待確認收件匣                                                             */
/* -------------------------------------------------------------------------- */

export type InboxItem = {
  jobId: string
  kind: AiJobKindValue
  label: string
  model: string
  projectId: string | null
  projectTitle: string
  episodeId: string | null
  episodeNumber: number | null
  finishedAt: string | null
  /** Hours since it finished, for the 「躺了多久」 line. */
  waitedHours: number
  candidates: number
  /** Opening of the first candidate, enough to recognise it by. */
  preview: string
  chars: number
  /** Whether 採用 writes the content, or only marks the job accepted. */
  writesTo: 'document' | null
  href: string | null
}

const PREVIEW_CHARS = 220

/**
 * Output waiting for a person.
 *
 * The one part of this page that is a to-do list rather than a readout. A
 * finished job in `AWAITING_REVIEW` is work already paid for that produces
 * nothing until somebody accepts it, and before this no screen anywhere
 * listed them — the two outlines in it had been waiting a day.
 *
 * Oldest first, deliberately: the queue below is newest-first because a queue
 * is about what is happening now, and an inbox is about what has been ignored
 * longest.
 */
export async function reviewInbox(limit = 30): Promise<InboxItem[]> {
  const rows = await db.execute<{
    id: string
    kind: string
    model: string
    project_id: string | null
    project_title: string | null
    episode_id: string | null
    episode_number: number | null
    target_type: string
    finished_at: Date | string | null
    waited_hours: string | null
    candidates: string
    preview: string | null
    chars: string | null
  }>(sql`
    select j.id::text as id,
           j.kind,
           j.model,
           j.project_id::text as project_id,
           p.title as project_title,
           j.episode_id::text as episode_id,
           e.number as episode_number,
           j.target_type,
           j.finished_at,
           (extract(epoch from (now() - j.finished_at)) / 3600)::text as waited_hours,
           coalesce(jsonb_array_length(j.result -> 'candidates'), 0)::text as candidates,
           left(j.result #>> '{candidates,0,content}', ${PREVIEW_CHARS}) as preview,
           length(j.result #>> '{candidates,0,content}')::text as chars
      from ai_jobs j
      left join projects p on p.id = j.project_id
      left join episodes e on e.id = j.episode_id
     where j.status = 'AWAITING_REVIEW'
     order by j.finished_at asc nulls last
     limit ${limit}
  `)

  return rows.rows.map((row) => ({
    jobId: row.id,
    kind: row.kind as AiJobKindValue,
    label: AI_JOB_KIND_LABEL[row.kind as AiJobKindValue] ?? row.kind,
    model: row.model,
    projectId: row.project_id,
    projectTitle: row.project_title ?? '',
    episodeId: row.episode_id,
    episodeNumber: row.episode_number,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    waitedHours: row.waited_hours === null ? 0 : Number(row.waited_hours),
    candidates: Number(row.candidates),
    preview: (row.preview ?? '').trim(),
    chars: row.chars === null ? 0 : Number(row.chars),
    writesTo: row.target_type === 'document' ? 'document' : null,
    href: hrefFor(row.kind, row.project_id, row.episode_id),
  }))
}

/** Where the person goes to deal with it in context. */
function hrefFor(kind: string, projectId: string | null, episodeId: string | null): string | null {
  if (!projectId) return null

  if (!episodeId) {
    if (kind === 'PROJECT_PLAN') return `/projects/${projectId}`
    if (kind === 'WORLD_GENERATE' || kind === 'WORLD_CONSISTENCY') {
      return `/projects/${projectId}/world`
    }
    if (kind === 'CHARACTER_DESIGN') return `/projects/${projectId}/characters`
    return `/projects/${projectId}/episodes`
  }

  const base = `/projects/${projectId}/episodes/${episodeId}`
  if (kind === 'NOVEL_TO_SCRIPT' || kind === 'SCRIPT_ANALYZE' || kind === 'STORYBOARD_GENERATE') {
    return `${base}/script`
  }
  if (kind.startsWith('NOVEL_')) return `${base}/novel`

  /*
   * 對白歸屬在看小說那邊處理 (Z138).
   *
   * 它的成果是「哪一句是誰說的」，而那件事唯一看得到效果的地方是有聲書的
   * 配音——不是編輯器。
   */
  if (kind === 'DIALOGUE_ATTRIBUTE') return `/read/${projectId}`

  /*
   * 退路是集數清單，不是 `${base}` (Z138).
   *
   * `/projects/<作品>/episodes/<集數>` **沒有這一頁**——那個目錄底下只有
   * novel / script / assets。所以舊的退路對任何沒有明確對應的種類都是 404，
   * 而使用者第一個踩到的是對白歸屬。清單頁吃 `?ep=`，會把那一集選起來。
   */
  return `/projects/${projectId}/episodes?ep=${episodeId}`
}
