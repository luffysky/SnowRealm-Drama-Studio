import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import {
  Activity,
  Bot,
  CalendarDays,
  CircleDollarSign,
  Clapperboard,
  FileText,
  Film,
  Image as ImageIcon,
  ListChecks,
  Mic,
  PenLine,
  Plus,
  Sparkles,
  TriangleAlert,
  Video,
  Wallet,
} from 'lucide-react'
import type { Metadata } from 'next'
import { db } from '@/db'
import {
  activities,
  aiJobs,
  arcs,
  episodeStages,
  episodes,
  expenses,
  projects,
  tasks,
  usageLedger,
  users,
} from '@/db/schema'
import {
  DonutChart,
  MeterRow,
  Panel,
  PendingAction,
  QuickAction,
  StatTile,
  type DonutSlice,
} from '@/components/studio/DashboardParts'
import { EmptyState } from '@/components/ui/StateViews'
import { ProgressBar } from '@/components/ui/StatusChip'
import { getSessionUser } from '@/lib/auth/session'
import {
  EXPENSE_CATEGORY_LABEL,
  STAGE_LABEL,
  STAGES,
  type ExpenseCategoryValue,
  type StageValue,
} from '@/lib/constants'
import { formatRelativeZh } from '@/lib/utils'

export const metadata: Metadata = { title: '總儀表板' }

/**
 * 總儀表板 (design 01).
 *
 * Every figure comes from a query. Spec v2 §0 is explicit that the numbers in
 * the mockup are illustrative and 「示意數字不得寫死」, so on a fresh database
 * this page legitimately shows zeros and empty states — that is the correct
 * output, not a bug.
 */
export default async function DashboardPage() {
  const user = await getSessionUser()

  const [project] = await db
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .limit(1)

  if (!project) {
    return (
      <div className="px-6 py-10">
        <EmptyState
          title="還沒有任何作品"
          description="執行 npm run db:seed 建立《一灶見山河》，或從作品頁新增一個作品。"
        />
      </div>
    )
  }

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [
    members,
    allArcs,
    statusRows,
    stageRows,
    aiRows,
    expenseRows,
    monthSpend,
    taskRows,
    recent,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.active, true)).orderBy(users.createdAt),

    db
      .select()
      .from(arcs)
      .where(and(eq(arcs.projectId, project.id), isNull(arcs.deletedAt)))
      .orderBy(arcs.index),

    db
      .select({ status: episodes.status, n: count() })
      .from(episodes)
      .where(and(eq(episodes.projectId, project.id), isNull(episodes.deletedAt)))
      .groupBy(episodes.status),

    db
      .select({
        stage: episodeStages.stage,
        done: sql<number>`count(*) filter (where ${episodeStages.state} = 'DONE')`.mapWith(Number),
        total: count(),
      })
      .from(episodeStages)
      .innerJoin(episodes, eq(episodes.id, episodeStages.episodeId))
      .where(and(eq(episodes.projectId, project.id), isNull(episodes.deletedAt)))
      .groupBy(episodeStages.stage),

    db
      .select({ kind: aiJobs.kind, n: count() })
      .from(aiJobs)
      .where(gte(aiJobs.createdAt, monthStart))
      .groupBy(aiJobs.kind),

    db
      .select({
        category: expenses.category,
        total: sql<string>`coalesce(sum(${expenses.amount} * ${expenses.exchangeRate}), 0)`,
      })
      .from(expenses)
      .where(and(eq(expenses.projectId, project.id), gte(expenses.spentAt, monthStart)))
      .groupBy(expenses.category),

    db
      .select({ total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)` })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.projectId, project.id),
          eq(usageLedger.kind, 'ACTUAL'),
          gte(usageLedger.occurredAt, monthStart)
        )
      ),

    db
      .select({ status: tasks.status, n: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, project.id), isNull(tasks.deletedAt)))
      .groupBy(tasks.status),

    db
      .select({
        id: activities.id,
        userName: activities.userName,
        summary: activities.summary,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .orderBy(desc(activities.createdAt))
      .limit(6),
  ])

  const totalEpisodes = statusRows.reduce((sum, r) => sum + Number(r.n), 0)
  const doneEpisodes = Number(statusRows.find((r) => r.status === 'DONE')?.n ?? 0)
  const inProduction = Number(statusRows.find((r) => r.status === 'PRODUCTION')?.n ?? 0)
  const inReview = Number(statusRows.find((r) => r.status === 'REVIEW')?.n ?? 0)

  const stageByKey = new Map(stageRows.map((r) => [r.stage, r]))
  const stageTotal = stageRows.reduce((sum, r) => sum + Number(r.total), 0)
  const stageDone = stageRows.reduce((sum, r) => sum + Number(r.done), 0)
  const overallPct = stageTotal > 0 ? Math.round((stageDone / stageTotal) * 100) : 0

  const aiTotal = aiRows.reduce((sum, r) => sum + Number(r.n), 0)
  const aiMax = Math.max(1, ...aiRows.map((r) => Number(r.n)))

  const spendUsd = Number(monthSpend[0]?.total ?? 0)
  const slices = buildSlices(expenseRows)
  const slicesTotal = slices.reduce((s, x) => s + x.value, 0)

  const openTasks = taskRows
    .filter((r) => r.status !== 'DONE')
    .reduce((sum, r) => sum + Number(r.n), 0)

  const greeting = greetingFor(new Date())

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6">
      {/* ------------------------------------------------------------ hero */}
      <section className="panel relative overflow-hidden rounded-2xl ring-1 ring-stage-700">
        {/* Gradient stands in until public/hero-banner.png is supplied. */}
        <div aria-hidden className="art-placeholder absolute inset-0" />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-stage-950 via-stage-950/85 to-transparent"
        />
        <div className="relative flex flex-col gap-1 px-6 py-7">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink-50">
            {greeting}，{user?.name ?? ''}
            <span className="text-sm font-normal text-ink-400">{user?.title}</span>
            {user?.title?.toUpperCase().includes('CEO') && <span aria-hidden>👑</span>}
          </h1>
          <p className="text-xs text-ink-400">
            歡迎回到 SnowRealm Drama Studio，一起把好故事拍成熱門短劇。
          </p>
        </div>
      </section>

      {/* --------------------------------------------- members + quick ops */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="panel flex items-center gap-3 rounded-xl bg-stage-900 px-4 py-3 ring-1 ring-stage-700"
            >
              <span
                className="bg-brand-gradient flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ring-1 ring-accent-500/50"
                aria-hidden
              >
                {member.name.charAt(0)}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1 truncate text-sm font-medium text-ink-50">
                  {member.name}
                  {member.title.toUpperCase().includes('CEO') && <span aria-hidden>👑</span>}
                </span>
                <span className="truncate text-[11px] text-ink-500">{member.title}</span>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
                  啟用中
                </span>
              </div>
            </div>
          ))}
        </div>

        <Panel title="快速操作" icon={<Sparkles aria-hidden className="size-3.5" />}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <QuickAction label="新建作品" icon={<Plus aria-hidden className="size-4" />} milestone="M1" />
            <QuickAction label="寫小說" icon={<PenLine aria-hidden className="size-4" />} milestone="M2" />
            <QuickAction label="劇本編寫" icon={<FileText aria-hidden className="size-4" />} milestone="M2" />
            <QuickAction label="生成畫面" icon={<ImageIcon aria-hidden className="size-4" />} milestone="M3" />
            <QuickAction label="生成影片" icon={<Video aria-hidden className="size-4" />} milestone="M3" />
            <QuickAction label="配音製作" icon={<Mic aria-hidden className="size-4" />} milestone="M3" />
          </div>
        </Panel>
      </div>

      {/* ----------------------------------------------------------- tiles */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="進行中作品"
          value="1"
          icon={<Film aria-hidden className="size-3.5" />}
          hint={`${allArcs.length} 個篇章`}
        />
        <StatTile
          label="總集數（規劃）"
          value={String(totalEpisodes)}
          icon={<Clapperboard aria-hidden className="size-3.5" />}
          hint={`已完成 ${doneEpisodes} 集`}
        />
        <StatTile
          label="本月 AI 任務"
          value={String(aiTotal)}
          unit="次"
          icon={<Bot aria-hidden className="size-3.5" />}
          hint={aiTotal === 0 ? '尚未執行任何任務' : undefined}
        />
        <StatTile
          label="本月 AI 成本"
          value={spendUsd > 0 ? `US$${spendUsd.toFixed(2)}` : 'US$0'}
          icon={<CircleDollarSign aria-hidden className="size-3.5" />}
          hint="已結算金額"
        />
        <StatTile
          label="待審核項目"
          value={String(inReview)}
          icon={<ListChecks aria-hidden className="size-3.5" />}
          tone={inReview > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="製作中集數"
          value={String(inProduction)}
          icon={<TriangleAlert aria-hidden className="size-3.5" />}
          tone={inProduction > 0 ? 'danger' : 'default'}
        />
      </section>

      {/* ---------------------------------------- progress / spend / aijobs */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="專案進度概覽"
          icon={<Activity aria-hidden className="size-3.5" />}
          action={<PendingAction label="查看全部" milestone="M1" />}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="art-placeholder size-14 shrink-0 rounded-lg ring-1 ring-stage-700"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium text-ink-50">
                  《{project.title}》
                </span>
                <span className="truncate text-[11px] text-ink-500">
                  {allArcs[0] ? `第${allArcs[0].index}部《${allArcs[0].title}》 · ` : ''}
                  共 {totalEpisodes} 集
                </span>
                <ProgressBar value={overallPct / 100} label="整體進度" />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-stage-700/60 pt-3">
              <span className="text-[11px] font-medium text-ink-400">製作階段</span>
              {STAGES.map((stage: StageValue) => {
                const row = stageByKey.get(stage)
                const total = Number(row?.total ?? 0)
                const done = Number(row?.done ?? 0)
                return (
                  <MeterRow
                    key={stage}
                    label={STAGE_LABEL[stage]}
                    value={done}
                    max={total}
                    trailing={`${done} / ${total}`}
                  />
                )
              })}
            </div>
          </div>
        </Panel>

        <Panel
          title="本月支出分布"
          icon={<Wallet aria-hidden className="size-3.5" />}
          action={<PendingAction label="查看明細" milestone="M4" />}
        >
          <DonutChart
            slices={slices}
            centerLabel="本月總支出"
            centerValue={slicesTotal > 0 ? `US$${slicesTotal.toFixed(2)}` : 'US$0'}
            emptyMessage="本月尚無支出紀錄"
          />
        </Panel>

        <Panel title="AI 任務狀態（本月）" icon={<Bot aria-hidden className="size-3.5" />}>
          {aiRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Bot aria-hidden className="size-6 text-ink-700" />
              <p className="text-[11px] text-ink-600">本月尚未執行 AI 任務</p>
              <p className="text-[10px] text-ink-700">設定 API 金鑰後即可開始使用</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {aiRows.map((row) => (
                <MeterRow
                  key={row.kind}
                  label={AI_SHORT[row.kind] ?? row.kind}
                  icon={<Sparkles aria-hidden className="size-3.5" />}
                  value={Number(row.n)}
                  max={aiMax}
                  trailing={`${Number(row.n)} 次`}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------ tasks / activity / today */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="待辦與提醒"
          icon={<ListChecks aria-hidden className="size-3.5" />}
          action={<PendingAction label="任務看板" milestone="M4" />}
        >
          {openTasks === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ListChecks aria-hidden className="size-6 text-ink-700" />
              <p className="text-[11px] text-ink-600">目前沒有待辦事項</p>
              <p className="text-[10px] text-ink-700">任務功能於 M4 階段交付</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {taskRows
                .filter((r) => r.status !== 'DONE')
                .map((row) => (
                  <li
                    key={row.status}
                    className="flex items-center justify-between rounded-lg bg-stage-850 px-3 py-2 text-[11px]"
                  >
                    <span className="text-ink-300">{row.status}</span>
                    <span className="text-ink-400">{Number(row.n)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel title="近期活動" icon={<Activity aria-hidden className="size-3.5" />}>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-ink-600">尚無操作紀錄</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {recent.map((item) => (
                <li key={item.id} className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="bg-brand-gradient mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  >
                    {item.userName.charAt(0) || '·'}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <p className="truncate text-[11px] text-ink-200">{item.summary}</p>
                    <p className="text-[10px] text-ink-600">
                      {item.userName} · {formatRelativeZh(item.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="今日重點"
          icon={<CalendarDays aria-hidden className="size-3.5" />}
          action={
            <span className="text-[11px] text-ink-600">
              {new Date().toLocaleDateString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                weekday: 'short',
              })}
            </span>
          }
        >
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CalendarDays aria-hidden className="size-6 text-ink-700" />
            <p className="text-[11px] text-ink-600">今日沒有排程項目</p>
            <p className="text-[10px] text-ink-700">排程功能於 M4 階段交付</p>
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ utils */

function greetingFor(now: Date): string {
  const hour = now.getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早安'
  if (hour < 14) return '午安'
  if (hour < 18) return '下午好'
  return '晚安'
}

/** Donut colours, drawn from the design system rather than arbitrary hexes. */
const SLICE_COLORS = [
  'var(--color-accent-500)',
  'var(--color-magenta-500)',
  '#38bdf8',
  '#34d399',
  'var(--color-gilt-400)',
  '#fb7185',
  'var(--color-ink-500)',
]

function buildSlices(
  rows: { category: ExpenseCategoryValue; total: string }[]
): DonutSlice[] {
  return rows
    .map((row, index) => ({
      label: EXPENSE_CATEGORY_LABEL[row.category] ?? row.category,
      value: Number(row.total),
      color: SLICE_COLORS[index % SLICE_COLORS.length]!,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** Short labels so the AI meter rows stay on one line. */
const AI_SHORT: Record<string, string> = {
  NOVEL_CONTINUE: '小說續寫',
  NOVEL_REWRITE: '小說改寫',
  NOVEL_POLISH: '潤稿',
  NOVEL_REVIEW: '審稿',
  NOVEL_TO_SCRIPT: '轉劇本',
  SCRIPT_ANALYZE: '劇本分析',
  STORYBOARD_GENERATE: '分鏡生成',
  CHARACTER_DESIGN: '角色設計',
  WORLD_GENERATE: '世界觀',
  WORLD_CONSISTENCY: '一致性',
  ASSET_GENERATE: '素材生成',
  TASK_SUGGEST: '任務建議',
  PROJECT_PLAN: '作品企劃',
}
