import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  activities,
  aiJobs,
  assets,
  chapters,
  characters,
  documents,
  episodeProductionStages,
  episodes,
  expenses,
  productionProgressEvents,
  projects,
  scenes,
  shots,
  tasks,
  worldEntries,
} from '@/db/schema'
import type { ProjectStatusValue } from '@/lib/constants'
import {
  aggregateProgress,
  PRODUCTION_STAGE_KEYS,
  STAGES_PER_EPISODE,
  type ProductionStageKey,
} from '@/lib/production'
import { visibleProjects } from '@/lib/project-access'

/**
 * 全域工作室儀表板 (design 01 v2).
 *
 * Cross-project only. Spec v3 §11.3 is explicit that this page must not offer
 * single-project editors, and that its figures come from real projects — the
 * second show in the reference art is not data.
 *
 * Every aggregate here follows the completion contract in
 * `src/lib/production.ts`: equivalents over effective stages, never the mean of
 * per-project percentages, which would let a one-episode project outvote a
 * 120-episode one.
 */

export type DashboardProject = {
  id: string
  title: string
  /** Empty = same as `title`. Read through `@/lib/project-titles`. */
  novelTitle: string
  dramaTitle: string
  status: ProjectStatusValue
  tags: string[]
  coverAssetId: string | null
  episodeCount: number
  plannedEpisodes: number
  stageRecords: number
  progress: number
}

export type DashboardTask = {
  id: string
  title: string
  projectId: string | null
  projectTitle: string
  dueDate: Date | null
  dueInDays: number | null
  priority: string
}

export type DashboardRisk = {
  id: string
  tone: 'high' | 'medium' | 'info'
  projectTitle: string
  text: string
}

export type TrendPoint = {
  /** `MM/DD`, already formatted in Asia/Taipei. */
  label: string
  completed: number
  started: number
  /** Cumulative completion across the window, 0–1. */
  cumulative: number
}

/**
 * 一天一格的動態脈搏。
 *
 * 來源是 `activities`，不是 `production_progress_events`——後者在正式庫裡是
 * **零筆**，所以「製作進度趨勢」那張圖從上線到現在沒有畫出過任何東西。而
 * `activities` 有六百多筆帶時間的真紀錄，那是**量到的**歷史，不是從現況回推的。
 */
export type PulsePoint = {
  /** `YYYY-MM-DD`（台北），當 key 用的，不是拿來顯示的。 */
  day: string
  /** `MM/DD`，軸上顯示的。 */
  label: string
  created: number
  updated: number
  uploaded: number
  ai: number
  total: number
}

export type AiPulse = {
  /** 期間內建立的任務數。 */
  total: number
  awaitingReview: number
  failed: number
  succeeded: number
  running: number
  cancelled: number
  inputTokens: number
  outputTokens: number
}

export type LibraryCounts = {
  chapters: number
  chapterChars: number
  scenes: number
  shots: number
  characters: number
  worldEntries: number
}

export type AssetSummary = { kind: string; count: number; bytes: number }

/**
 * 花費依幣別分開，**不換算**。
 *
 * 匯率是當天的，而這裡沒有地方放「用的是哪一天的匯率」——換算過的數字看起來
 * 像事實，而它是一個推論。AI 的花費也走這一份（`expenses.ai_job_id`），不要
 * 從 `ai_jobs.actual_cost` 另外算一次：兩邊各算一次就會對不起來。
 */
export type SpendSummary = { currency: string; amount: number; count: number }

/** 可選的期間。改這裡就好，頁面上的切換鍵是從這個陣列長出來的。 */
export const DASHBOARD_RANGES = [7, 30, 90] as const
export type DashboardRange = (typeof DASHBOARD_RANGES)[number]

/**
 * 把網址上的 `?d=` 讀成一個合法的期間。
 *
 * 認不得就回 30——這個值會進 SQL 的區間算式，所以**不可以**直接相信它。
 */
export function readRange(value: string | undefined): DashboardRange {
  const n = Number(value)
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? (n as DashboardRange) : 30
}

export type DashboardData = {
  activeProjects: number
  totalProjects: number
  totalEpisodes: number
  stageRecords: number
  /** 0–1 across every effective stage of every visible project. */
  overallProgress: number
  stageTotals: { completed: number; inProgress: number; pending: number }
  projects: DashboardProject[]
  statusCounts: Record<string, number>
  stageBreakdown: { key: ProductionStageKey; done: number; total: number }[]
  tasks: DashboardTask[]
  risks: DashboardRisk[]
  trend: TrendPoint[]
  /** Null when no stage has ever changed — the trend has nothing to draw. */
  trendStartedAt: Date | null
  recentActivity: {
    id: string
    summary: string
    userName: string
    action: string
    entityType: string
    projectId: string | null
    createdAt: Date
  }[]
  /** 目前看的是哪一個範圍——頁面要把它標在切換鍵上。 */
  scope: { days: DashboardRange; projectId: string | null }
  pulse: PulsePoint[]
  pulseTotal: number
  ai: AiPulse
  library: LibraryCounts
  assets: AssetSummary[]
  spend: SpendSummary[]
}

const STAGE_FRACTION = sql<string>`
  case
    when ${episodeProductionStages.status} = 'completed' then 1.0
    when ${episodeProductionStages.status} = 'not_started' then 0.0
    else least(greatest(coalesce(${episodeProductionStages.progressPercent}, 0), 0), 100) / 100.0
  end
`

export async function getDashboard(
  userId: string,
  options: { projectId?: string | null; days?: DashboardRange } = {}
): Promise<DashboardData> {
  const trendDays: DashboardRange = options.days ?? 30
  const visible = visibleProjects(userId)

  const projectRows = await db
    .select({
      id: projects.id,
      title: projects.title,
      novelTitle: projects.novelTitle,
      dramaTitle: projects.dramaTitle,
      status: projects.status,
      tags: projects.tags,
      coverAssetId: projects.coverAssetId,
    })
    .from(projects)
    .where(visible)
    .orderBy(desc(projects.isFlagship), desc(projects.updatedAt))

  const ids = projectRows.map((row) => row.id)

  if (ids.length === 0) {
    return {
      activeProjects: 0,
      totalProjects: 0,
      totalEpisodes: 0,
      stageRecords: 0,
      overallProgress: 0,
      stageTotals: { completed: 0, inProgress: 0, pending: 0 },
      projects: [],
      statusCounts: {},
      stageBreakdown: PRODUCTION_STAGE_KEYS.map((key) => ({ key, done: 0, total: 0 })),
      tasks: [],
      risks: [],
      trend: [],
      trendStartedAt: null,
      recentActivity: [],
      scope: { days: trendDays, projectId: null },
      pulse: [],
      pulseTotal: 0,
      ai: {
        total: 0,
        awaitingReview: 0,
        failed: 0,
        succeeded: 0,
        running: 0,
        cancelled: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      library: {
        chapters: 0,
        chapterChars: 0,
        scenes: 0,
        shots: 0,
        characters: 0,
        worldEntries: 0,
      },
      assets: [],
      spend: [],
    }
  }

  /*
   * 作品篩選**不是**一條讀得到別人作品的路。
   *
   * `ids` 已經過 `visibleProjects()`，而網址上選的那一個必須在裡面才算數——
   * 不在就退回全部，而不是拿著查詢字串上的值直接去查。
   */
  const scoped = options.projectId && ids.includes(options.projectId) ? options.projectId : null
  const scopedIds = scoped ? [scoped] : ids

  const windowStart = new Date(Date.now() - trendDays * 86_400_000)

  const [
    episodeRows,
    stageRows,
    stageByKey,
    taskRows,
    blockedRows,
    trendRows,
    firstEvent,
    recent,
    pulseRows,
    aiRows,
    assetRows,
    spendRows,
    chapterRows,
    sceneRows,
    shotRows,
    characterRows,
    worldRows,
  ] = await Promise.all([
    db
      .select({ projectId: episodes.projectId, n: count() })
      .from(episodes)
      .where(and(inArray(episodes.projectId, ids), isNull(episodes.deletedAt)))
      .groupBy(episodes.projectId),

    db
      .select({
        projectId: episodeProductionStages.projectId,
        total: count(),
        done: sql<string>`sum(${STAGE_FRACTION})`,
        completed: sql<number>`count(*) filter (where ${episodeProductionStages.status} = 'completed')`.mapWith(
          Number
        ),
        inProgress: sql<number>`count(*) filter (where ${episodeProductionStages.status} in ('in_progress','in_review','blocked'))`.mapWith(
          Number
        ),
      })
      .from(episodeProductionStages)
      .where(inArray(episodeProductionStages.projectId, ids))
      .groupBy(episodeProductionStages.projectId),

    db
      .select({
        stageKey: episodeProductionStages.stageKey,
        total: count(),
        done: sql<string>`sum(${STAGE_FRACTION})`,
      })
      .from(episodeProductionStages)
      .where(inArray(episodeProductionStages.projectId, scopedIds))
      .groupBy(episodeProductionStages.stageKey),

    db
      .select({
        id: tasks.id,
        title: tasks.title,
        projectId: tasks.projectId,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(
        and(inArray(tasks.projectId, scopedIds), isNull(tasks.deletedAt), ne(tasks.status, 'DONE'))
      )
      .orderBy(sql`${tasks.dueDate} asc nulls last`)
      .limit(8),

    db
      .select({
        projectId: episodeProductionStages.projectId,
        stageKey: episodeProductionStages.stageKey,
        n: count(),
      })
      .from(episodeProductionStages)
      .where(
        and(
          inArray(episodeProductionStages.projectId, scopedIds),
          eq(episodeProductionStages.status, 'blocked')
        )
      )
      .groupBy(episodeProductionStages.projectId, episodeProductionStages.stageKey),

    /*
     * The 30-day trend comes from the audit table, which is the only place that
     * records *when* a stage moved. Nothing is reconstructed from the current
     * state: a stage finished last week and one finished today look identical
     * in `episode_production_stages`, so inventing a curve from it would be
     * fabrication.
     */
    db
      .select({
        day: sql<string>`to_char(${productionProgressEvents.createdAt} at time zone 'Asia/Taipei', 'MM/DD')`,
        completed: sql<number>`count(*) filter (where ${productionProgressEvents.toStatus} = 'completed')`.mapWith(
          Number
        ),
        started: sql<number>`count(*) filter (where ${productionProgressEvents.toStatus} = 'in_progress')`.mapWith(
          Number
        ),
      })
      .from(productionProgressEvents)
      .where(
        and(
          inArray(productionProgressEvents.projectId, scopedIds),
          gte(productionProgressEvents.createdAt, windowStart)
        )
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db
      .select({ at: productionProgressEvents.createdAt })
      .from(productionProgressEvents)
      .where(inArray(productionProgressEvents.projectId, scopedIds))
      .orderBy(productionProgressEvents.createdAt)
      .limit(1),

    /*
     * 近期動態原本**一個 where 都沒有**，撈的是整張 activities。
     *
     * 今天還不是可利用的漏洞（`visibleProjects()` 讓兩個人都看得到所有作
     * 品），但這跟 Z190 查出來的匯出那條是同一類：`project-access.ts` 的註解
     * 寫著「收緊成員權限時只要改一個地方」，而這一行就是那個地方改完之後還
     * 會漏的。
     *
     * 另外排掉 `login`：六百多筆動態裡有兩百七十六筆是登入，不排的話這個面
     * 板永遠是八筆「某某登入了」——技術上是真的，資訊量是零。
     */
    db
      .select({
        id: activities.id,
        summary: activities.summary,
        userName: activities.userName,
        action: activities.action,
        entityType: activities.entityType,
        projectId: activities.projectId,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .where(and(inArray(activities.projectId, scopedIds), ne(activities.action, 'login')))
      .orderBy(desc(activities.createdAt))
      .limit(12),

    /* ---- 以下是這次新加的 (Z191) ------------------------------------- */

    /*
     * 一天一格的動態脈搏。
     *
     * 這張圖取代了原本那張**永遠空白**的「製作進度趨勢」：
     * `production_progress_events` 在正式庫裡是零筆，而 `activities` 有六百
     * 多筆帶時間的真紀錄。兩張都是量到的歷史，差別只在哪一張真的有東西。
     */
    db
      .select({
        day: sql<string>`to_char(${activities.createdAt} at time zone 'Asia/Taipei', 'YYYY-MM-DD')`,
        created: sql<number>`count(*) filter (where ${activities.action} = 'create')`.mapWith(
          Number
        ),
        updated: sql<number>`count(*) filter (where ${activities.action} = 'update')`.mapWith(
          Number
        ),
        uploaded: sql<number>`count(*) filter (where ${activities.action} = 'upload')`.mapWith(
          Number
        ),
        ai: sql<number>`count(*) filter (where ${activities.action} like 'ai.%')`.mapWith(Number),
        total: count(),
      })
      .from(activities)
      .where(
        and(
          inArray(activities.projectId, scopedIds),
          ne(activities.action, 'login'),
          gte(activities.createdAt, windowStart)
        )
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    /*
     * AI 任務。`projectId` 可以是 null（跨作品的），那一種不算進來——這一格
     * 跟著上面的作品篩選走。
     */
    db
      .select({
        total: count(),
        awaitingReview:
          sql<number>`count(*) filter (where ${aiJobs.status} = 'AWAITING_REVIEW')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${aiJobs.status} = 'FAILED')`.mapWith(Number),
        succeeded: sql<number>`count(*) filter (where ${aiJobs.status} = 'SUCCEEDED')`.mapWith(
          Number
        ),
        running:
          sql<number>`count(*) filter (where ${aiJobs.status} in ('QUEUED','RUNNING'))`.mapWith(
            Number
          ),
        cancelled: sql<number>`count(*) filter (where ${aiJobs.status} = 'CANCELLED')`.mapWith(
          Number
        ),
        inputTokens: sql<number>`coalesce(sum(${aiJobs.inputTokens}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${aiJobs.outputTokens}), 0)`.mapWith(Number),
      })
      .from(aiJobs)
      .where(and(inArray(aiJobs.projectId, scopedIds), gte(aiJobs.createdAt, windowStart))),

    /* 素材。只算 LIBRARY，跟素材中心同一個口徑，不然兩頁的數字會對不起來。 */
    db
      .select({
        kind: assets.kind,
        count: count(),
        bytes: sql<number>`coalesce(sum(${assets.sizeBytes}), 0)`.mapWith(Number),
      })
      .from(assets)
      .where(
        and(
          inArray(assets.projectId, scopedIds),
          eq(assets.origin, 'LIBRARY'),
          isNull(assets.deletedAt)
        )
      )
      .groupBy(assets.kind),

    /* 花費。依幣別分開，不換算。 */
    db
      .select({
        currency: expenses.currency,
        amount: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
        count: count(),
      })
      .from(expenses)
      .where(and(inArray(expenses.projectId, scopedIds), gte(expenses.spentAt, windowStart)))
      .groupBy(expenses.currency),

    /* 存量：寫了多少、畫了多少、設定了多少。 */
    db
      .select({
        n: count(),
        chars: sql<number>`coalesce(sum(${chapters.charCount}), 0)`.mapWith(Number),
      })
      .from(chapters)
      .innerJoin(documents, eq(documents.id, chapters.documentId))
      .innerJoin(episodes, eq(episodes.id, documents.episodeId))
      .where(
        and(
          inArray(episodes.projectId, scopedIds),
          isNull(documents.deletedAt),
          isNull(episodes.deletedAt)
        )
      ),

    db
      .select({ n: count() })
      .from(scenes)
      .innerJoin(documents, eq(documents.id, scenes.documentId))
      .innerJoin(episodes, eq(episodes.id, documents.episodeId))
      .where(
        and(
          inArray(episodes.projectId, scopedIds),
          isNull(documents.deletedAt),
          isNull(episodes.deletedAt)
        )
      ),

    db
      .select({ n: count() })
      .from(shots)
      .innerJoin(episodes, eq(episodes.id, shots.episodeId))
      .where(and(inArray(episodes.projectId, scopedIds), isNull(episodes.deletedAt))),

    db
      .select({ n: count() })
      .from(characters)
      .where(and(inArray(characters.projectId, scopedIds), isNull(characters.deletedAt))),

    db
      .select({ n: count() })
      .from(worldEntries)
      .where(and(inArray(worldEntries.projectId, scopedIds), isNull(worldEntries.deletedAt))),
  ])

  const episodesBy = new Map(episodeRows.map((r) => [r.projectId, Number(r.n)]))
  const stagesBy = new Map(stageRows.map((r) => [r.projectId, r]))
  const titleOf = new Map(projectRows.map((r) => [r.id, r.title]))

  let totalEquivalents = 0
  let totalEffective = 0
  let completedRecords = 0
  let inProgressRecords = 0

  const dashboardProjects: DashboardProject[] = projectRows.map((row) => {
    const episodeCount = episodesBy.get(row.id) ?? 0
    const stage = stagesBy.get(row.id)

    // Planned records, so an episode with no stage rows still counts as work.
    const effective = Math.max(episodeCount * STAGES_PER_EPISODE, Number(stage?.total ?? 0))
    const done = Number(stage?.done ?? 0)

    /*
     * 上面的數字只加**選到的**作品。
     *
     * 作品總覽那一欄還是列全部，因為那一欄同時是切換鍵——點進去才知道自己
     * 現在看的是哪一個。
     */
    if (scopedIds.includes(row.id)) {
      totalEquivalents += done
      totalEffective += effective
      completedRecords += Number(stage?.completed ?? 0)
      inProgressRecords += Number(stage?.inProgress ?? 0)
    }

    return {
      id: row.id,
      title: row.title,
      novelTitle: row.novelTitle,
      dramaTitle: row.dramaTitle,
      status: row.status,
      tags: row.tags,
      coverAssetId: row.coverAssetId,
      episodeCount,
      plannedEpisodes: episodeCount,
      stageRecords: effective,
      progress: aggregateProgress(done, effective),
    }
  })

  const scopedProjects = dashboardProjects.filter((project) => scopedIds.includes(project.id))

  const statusCounts: Record<string, number> = { ALL: dashboardProjects.length }
  for (const project of dashboardProjects) {
    statusCounts[project.status] = (statusCounts[project.status] ?? 0) + 1
  }

  const now = Date.now()
  const dashboardTasks: DashboardTask[] = taskRows.map((row) => ({
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    projectTitle: titleOf.get(row.projectId ?? '') ?? '',
    dueDate: row.dueDate,
    dueInDays: row.dueDate ? Math.ceil((row.dueDate.getTime() - now) / 86_400_000) : null,
    priority: row.priority,
  }))

  const risks: DashboardRisk[] = []
  for (const task of dashboardTasks) {
    if (task.dueInDays !== null && task.dueInDays < 0) {
      risks.push({
        id: `overdue-${task.id}`,
        tone: 'high',
        projectTitle: task.projectTitle,
        text: `${task.title}（逾期 ${Math.abs(task.dueInDays)} 天）`,
      })
    }
  }
  for (const row of blockedRows) {
    risks.push({
      id: `blocked-${row.projectId}-${row.stageKey}`,
      tone: 'medium',
      projectTitle: titleOf.get(row.projectId) ?? '',
      text: `${row.n} 集卡在${stageLabel(row.stageKey)}`,
    })
  }

  // Cumulative completion across the window, so the line only ever rises.
  let running = 0
  const trend: TrendPoint[] = trendRows.map((row) => {
    running += Number(row.completed)
    return {
      label: row.day,
      completed: Number(row.completed),
      started: Number(row.started),
      cumulative: totalEffective > 0 ? Math.min(running / totalEffective, 1) : 0,
    }
  })

  const ai = aiRows[0]
  const chapterRow = chapterRows[0]

  return {
    activeProjects: scopedProjects.filter(
      (p) => p.status === 'IN_PRODUCTION' || p.status === 'POST_PRODUCTION'
    ).length,
    totalProjects: dashboardProjects.length,
    totalEpisodes: scopedProjects.reduce((n, p) => n + p.episodeCount, 0),
    stageRecords: totalEffective,
    overallProgress: aggregateProgress(totalEquivalents, totalEffective),
    stageTotals: {
      completed: completedRecords,
      inProgress: inProgressRecords,
      pending: Math.max(totalEffective - completedRecords - inProgressRecords, 0),
    },
    projects: dashboardProjects,
    statusCounts,
    stageBreakdown: PRODUCTION_STAGE_KEYS.map((key) => {
      const row = stageByKey.find((r) => r.stageKey === key)
      return { key, done: Number(row?.done ?? 0), total: Number(row?.total ?? 0) }
    }),
    tasks: dashboardTasks,
    risks: risks.slice(0, 6),
    trend,
    trendStartedAt: firstEvent[0]?.at ?? null,
    recentActivity: recent,
    scope: { days: trendDays, projectId: scoped },
    pulse: fillDays(pulseRows, trendDays),
    pulseTotal: pulseRows.reduce((n, row) => n + Number(row.total), 0),
    ai: {
      total: Number(ai?.total ?? 0),
      awaitingReview: Number(ai?.awaitingReview ?? 0),
      failed: Number(ai?.failed ?? 0),
      succeeded: Number(ai?.succeeded ?? 0),
      running: Number(ai?.running ?? 0),
      cancelled: Number(ai?.cancelled ?? 0),
      inputTokens: Number(ai?.inputTokens ?? 0),
      outputTokens: Number(ai?.outputTokens ?? 0),
    },
    library: {
      chapters: Number(chapterRow?.n ?? 0),
      chapterChars: Number(chapterRow?.chars ?? 0),
      scenes: Number(sceneRows[0]?.n ?? 0),
      shots: Number(shotRows[0]?.n ?? 0),
      characters: Number(characterRows[0]?.n ?? 0),
      worldEntries: Number(worldRows[0]?.n ?? 0),
    },
    assets: assetRows
      .map((row) => ({ kind: row.kind, count: Number(row.count), bytes: Number(row.bytes) }))
      .sort((a, b) => b.bytes - a.bytes),
    spend: spendRows
      .map((row) => ({
        currency: row.currency,
        amount: Number(row.amount),
        count: Number(row.count),
      }))
      .sort((a, b) => b.amount - a.amount),
  }
}

/**
 * 把沒有動態的那幾天補成 0。
 *
 * `group by` 只會回有資料的日子，所以 11/06 跟 11/08 之間少了一天的話，長條
 * 圖會把它們畫成相鄰的兩根——那張圖就在說「中間那天也有做事」。補零之後空的
 * 那天是一個看得見的缺口。
 *
 * 日期在**台北時區**切，跟 SQL 裡的 `at time zone 'Asia/Taipei'` 同一個切法；
 * 伺服器的時鐘是 UTC，用本地日期會讓每天早上八點前的事落到前一天。
 */
function fillDays(
  rows: { day: string; created: number; updated: number; uploaded: number; ai: number; total: number }[],
  days: number
): PulsePoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const out: PulsePoint[] = []

  for (let back = days - 1; back >= 0; back -= 1) {
    const day = taipeiDay(new Date(Date.now() - back * 86_400_000))
    const row = byDay.get(day)
    out.push({
      day,
      label: `${day.slice(5, 7)}/${day.slice(8, 10)}`,
      created: Number(row?.created ?? 0),
      updated: Number(row?.updated ?? 0),
      uploaded: Number(row?.uploaded ?? 0),
      ai: Number(row?.ai ?? 0),
      total: Number(row?.total ?? 0),
    })
  }
  return out
}

/** `YYYY-MM-DD` in Asia/Taipei. `en-CA` is the locale that formats that way. */
function taipeiDay(when: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when)
}

function stageLabel(key: string): string {
  const labels: Record<string, string> = {
    story_planning: '劇情規劃',
    novel: '小說創作',
    script: '劇本改編',
    storyboard: '分鏡設計',
    assets: '素材製作',
    video: '影像製作',
    postproduction: '後製剪輯',
    review: '審核調整',
    release: '上架發布',
  }
  return labels[key] ?? key
}
