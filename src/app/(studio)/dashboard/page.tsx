import {
  Activity,
  AlertTriangle,
  Clapperboard,
  ClipboardList,
  Film,
  Layers,
  ListChecks,
  Plus,
  TrendingUp,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { getSessionUser } from '@/lib/auth/session'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE } from '@/lib/constants'
import { getDashboard, type DashboardData } from '@/lib/dashboard'
import {
  PRODUCTION_STAGE_LABEL,
  stageOrdinal,
  STAGES_PER_EPISODE,
  toPercent,
} from '@/lib/production'
import { cn, formatRelativeZh } from '@/lib/utils'
import { AltTitles } from '@/components/studio/AltTitles'
import { assetPreviewUrl } from '@/lib/asset-url'

export const metadata: Metadata = { title: '工作室儀表板' }

/**
 * 01 全域工作室儀表板 (design 01 v2).
 *
 * Cross-project only: no single-project editor is reachable from here
 * (spec v3 §11.3). Every figure is read from the database — with an empty
 * studio this page legitimately shows zeros and empty states, and that is the
 * correct output rather than a reason to seed something.
 */
export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const data = await getDashboard(user.id)

  if (data.totalProjects === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="還沒有任何作品"
          description="建立第一部作品之後，這裡會顯示跨作品的集數、階段與進度摘要。"
          icon={<Clapperboard aria-hidden className="size-5 text-ink-500" />}
          action={
            <Link
              href="/projects"
              className="bg-brand-gradient glow-accent-sm inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white"
            >
              <Plus aria-hidden className="size-3.5" />
              前往作品列表
            </Link>
          }
          className="py-24"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <GreetingHero name={user.name} data={data} />
      <KpiRow data={data} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ProjectsPanel data={data} />
        <TrendPanel data={data} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <StagePanel data={data} />
        <TaskPanel data={data} />
        <RiskPanel data={data} />
      </div>

      <ActivityPanel data={data} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The greeting banner (`docs/NEEDED_FROM_YOU.md` C3).
 *
 * The brief asked for artwork whose left 40% was dark enough to carry text.
 * The supplied master is bright there — blossom and a lit lamp — so
 * `.scrim-hero` lays the darkness over it instead of relying on the file.
 *
 * The figures beside the greeting are the same ones the tiles below show; they
 * are repeated here because this strip is what gets read first, and an empty
 * studio never reaches this component at all.
 */
function GreetingHero({ name, data }: { name: string; data: DashboardData }) {
  return (
    <section className="panel relative isolate overflow-hidden rounded-xl ring-1 ring-stage-700">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/hero.webp"
        alt=""
        aria-hidden
        fetchPriority="high"
        // `object-right` keeps the castle and moon in frame as the strip
        // narrows, and pushes the busy left edge out from under the text.
        className="absolute inset-0 -z-10 size-full object-cover object-right"
      />
      <div aria-hidden className="scrim-hero absolute inset-0 -z-10" />
      {/*
        Below `sm` the greeting wraps and the second line runs out over the
        waterfall, where the left-to-right scrim has already faded out. A flat
        dim across the whole strip covers that; above `sm` the text stays in
        the dark third and this would only mute the artwork for nothing.
      */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-stage-950/45 sm:hidden" />

      <div className="flex flex-col gap-1 px-5 py-6 sm:py-8 lg:px-7 lg:py-10">
        <p className="text-lg font-semibold tracking-tight text-ink-50 sm:text-xl">
          {greetingZh()}，{name}
        </p>
        {/*
          Each figure is its own nowrap span. Left to itself the line broke
          inside a phrase on a phone — 「整體完 / 成 0.0%」 — so the separators
          are the only places a break is allowed.
        */}
        <p className="flex flex-wrap items-baseline text-[11px] leading-relaxed text-ink-300 sm:text-xs">
          <span className="whitespace-nowrap">{data.activeProjects} 部進行中</span>
          <Dot />
          <span className="whitespace-nowrap">
            共 {data.totalEpisodes.toLocaleString('en-US')} 集
          </span>
          <Dot />
          <span className="whitespace-nowrap">
            整體完成 {(data.overallProgress * 100).toFixed(1)}%
          </span>
        </p>
      </div>
    </section>
  )
}

function Dot() {
  return (
    <span aria-hidden className="mx-1.5 text-ink-600">
      ·
    </span>
  )
}

/**
 * Time-of-day greeting, fixed to Asia/Taipei.
 *
 * This renders on the server, where the clock is UTC — reading the raw hour
 * would wish someone a good morning at eight in the evening. `h23` rather than
 * `hour12: false`, because the latter reports midnight as hour 24.
 */
export function greetingZh(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now)
  )

  if (hour < 5) return '夜深了'
  if (hour < 11) return '早安'
  if (hour < 14) return '午安'
  if (hour < 18) return '午後好'
  return '晚安'
}

/* -------------------------------------------------------------------------- */

function KpiRow({ data }: { data: DashboardData }) {
  const totals = data.stageTotals
  const pctOf = (n: number) =>
    data.stageRecords > 0 ? `${((n / data.stageRecords) * 100).toFixed(1)}%` : '—'

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile icon={<Clapperboard className="size-4" />} label="進行中作品">
        <p className="text-2xl font-semibold text-ink-50">
          {data.activeProjects}
          <span className="ml-1 text-sm font-normal text-ink-500">部</span>
        </p>
        <p className="mt-1 text-[11px] text-ink-600">共 {data.totalProjects} 部作品</p>
      </Tile>

      <Tile icon={<ClipboardList className="size-4" />} label="總集數（全部作品）">
        <p className="text-2xl font-semibold text-ink-50">
          {data.totalEpisodes.toLocaleString('en-US')}
          <span className="ml-1 text-sm font-normal text-ink-500">集</span>
        </p>
        <p className="mt-1 text-[11px] text-ink-600">跨作品合計</p>
      </Tile>

      <Tile icon={<Layers className="size-4" />} label="製作階段紀錄">
        <p className="text-2xl font-semibold text-ink-50">
          {data.stageRecords.toLocaleString('en-US')}
          <span className="ml-1 text-sm font-normal text-ink-500">筆</span>
        </p>
        <p className="mt-1 text-[11px] text-ink-600">
          集數 × {STAGES_PER_EPISODE} 階段
        </p>
      </Tile>

      <Tile icon={<Activity className="size-4" />} label="整體完成率">
        <div className="flex items-center gap-3">
          <Donut fraction={data.overallProgress} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {[
              { label: '已完成', value: totals.completed, dot: 'text-emerald-400' },
              { label: '進行中', value: totals.inProgress, dot: 'text-accent-400' },
              { label: '待處理', value: totals.pending, dot: 'text-ink-600' },
            ].map((slice) => (
              <div key={slice.label} className="flex items-center gap-1.5 text-[10px]">
                <span aria-hidden className={cn('text-[8px]', slice.dot)}>
                  ●
                </span>
                <span className="text-ink-500">{slice.label}</span>
                <span className="ml-auto text-ink-300 tabular-nums">
                  {slice.value.toLocaleString('en-US')}
                </span>
                <span className="w-11 text-right text-ink-600 tabular-nums">
                  {pctOf(slice.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Tile>
    </div>
  )
}

function Tile({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <section className="panel flex flex-col rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <h2 className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
        <span aria-hidden className="text-accent-400">
          {icon}
        </span>
        {label}
      </h2>
      {children}
    </section>
  )
}

/** Completion ring. Pure SVG; a chart library for one arc is not worth it. */
function Donut({ fraction }: { fraction: number }) {
  const radius = 22
  const circumference = 2 * Math.PI * radius
  const filled = circumference * Math.min(Math.max(fraction, 0), 1)

  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 56 56" className="size-full -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={radius} fill="none" strokeWidth="7" className="stroke-stage-800" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-accent-500"
          strokeDasharray={`${filled.toFixed(2)} ${circumference.toFixed(2)}`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-ink-50">
        {toPercent(fraction)}%
      </span>
    </div>
  )
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel flex min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
      <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
        <span aria-hidden className="text-accent-400">
          {icon}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-ink-200">{title}</h2>
        {action}
      </header>
      <div className="min-w-0 flex-1 p-4">{children}</div>
    </section>
  )
}

function ProjectsPanel({ data }: { data: DashboardData }) {
  return (
    <Panel
      title="作品總覽"
      icon={<Film className="size-3.5" />}
      action={
        <Link
          href="/projects"
          className="shrink-0 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          查看全部 →
        </Link>
      }
    >
      <ul className="flex flex-col gap-2">
        {data.projects.map((project) => (
          <li key={project.id}>
            {/* Clicking a card carries the right projectId — spec v3 §11.3. */}
            <Link
              href={`/projects/${project.id}`}
              className="panel flex items-center gap-3 rounded-lg bg-stage-850 p-2 ring-1 ring-stage-700 transition-all hover:ring-stage-600"
            >
              {project.coverAssetId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetPreviewUrl(project.coverAssetId)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-14 w-24 shrink-0 rounded object-cover"
                />
              ) : (
                <div aria-hidden className="art-placeholder h-14 w-24 shrink-0 rounded" />
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink-50">
                    《{project.title}》
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
                      PROJECT_STATUS_STYLE[project.status]
                    )}
                  >
                    {PROJECT_STATUS_LABEL[project.status]}
                  </span>
                  {project.tags.length > 0 && (
                    <span className="truncate text-[10px] text-ink-600">
                      {project.tags.join(' × ')}
                    </span>
                  )}
                </div>

                {/* A name set in 作品設定 that appears nowhere looks like one
                    that was never saved. */}
                <AltTitles project={project} compact />

                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[11px] text-ink-500 tabular-nums">
                    {project.episodeCount} 集｜{STAGES_PER_EPISODE} 階段
                  </span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
                    <div
                      className="bg-brand-gradient h-full rounded-full"
                      style={{ width: `${toPercent(project.progress)}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[11px] text-ink-200 tabular-nums">
                    {toPercent(project.progress)}%
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * 製作進度趨勢.
 *
 * Drawn from `production_progress_events`, the only record of *when* a stage
 * moved. A finished stage looks the same today as it did last week in
 * `episode_production_stages`, so a curve reconstructed from current state
 * would be invented rather than measured — hence the empty state until the
 * first stage actually changes.
 */
function TrendPanel({ data }: { data: DashboardData }) {
  const max = Math.max(1, ...data.trend.map((p) => p.completed + p.started))

  return (
    <Panel title="製作進度趨勢（近 30 天）" icon={<TrendingUp className="size-3.5" />}>
      {data.trend.length === 0 ? (
        <EmptyState
          title="尚無進度變更紀錄"
          description={
            data.trendStartedAt
              ? '近 30 天內沒有階段異動。'
              : '階段狀態第一次變更後，這裡會以稽核紀錄繪出趨勢，不會從目前狀態回推。'
          }
          icon={<TrendingUp aria-hidden className="size-5 text-ink-500" />}
          className="py-10"
        />
      ) : (
        <div className="flex h-40 items-end gap-1">
          {data.trend.map((point) => (
            <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 flex-col justify-end gap-px">
                <div
                  title={`進行中 ${point.started}`}
                  className="w-full rounded-t bg-accent-500/70"
                  style={{ height: `${(point.started / max) * 100}%` }}
                />
                <div
                  title={`已完成 ${point.completed}`}
                  className="w-full bg-emerald-500/80"
                  style={{ height: `${(point.completed / max) * 100}%` }}
                />
              </div>
              <span className="truncate text-[8px] text-ink-700">{point.label}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function StagePanel({ data }: { data: DashboardData }) {
  return (
    <Panel title="整體製作流程（九大階段）" icon={<Layers className="size-3.5" />}>
      <ul className="flex flex-col gap-2">
        {data.stageBreakdown.map((stage) => {
          const fraction = stage.total > 0 ? stage.done / stage.total : 0
          return (
            <li key={stage.key} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-[10px] text-ink-700 tabular-nums">
                {stageOrdinal(stage.key)}
              </span>
              <span className="w-16 shrink-0 truncate text-[11px] text-ink-400">
                {PRODUCTION_STAGE_LABEL[stage.key]}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
                <div
                  className="bg-brand-gradient h-full rounded-full"
                  style={{ width: `${toPercent(fraction)}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[10px] text-ink-300 tabular-nums">
                {toPercent(fraction)}%
              </span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function TaskPanel({ data }: { data: DashboardData }) {
  return (
    <Panel
      title={`待處理任務（跨作品${data.tasks.length > 0 ? ` ${data.tasks.length}` : ''}）`}
      icon={<ListChecks className="size-3.5" />}
      action={
        <span
          aria-disabled="true"
          title="跨作品任務頁尚未實作，預計於 M4 階段交付"
          className="shrink-0 cursor-default text-[11px] text-ink-600 select-none"
        >
          查看全部 M4
        </span>
      }
    >
      {data.tasks.length === 0 ? (
        <EmptyState
          title="目前沒有待處理任務"
          description="任務看板於 M4 階段交付，屆時可在此跨作品指派與追蹤。"
          icon={<ListChecks aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3.5 shrink-0 rounded border border-stage-600 bg-stage-850"
              />
              {task.projectTitle && (
                <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[10px] text-ink-400 ring-1 ring-inset ring-stage-700">
                  {task.projectTitle}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-ink-200">{task.title}</span>
              <DueChip days={task.dueInDays} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function DueChip({ days }: { days: number | null }) {
  if (days === null) return <span className="shrink-0 text-[10px] text-ink-700">未定</span>

  const label = days === 0 ? '今天' : days < 0 ? `逾期 ${Math.abs(days)} 天` : `${days} 天後`
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset tabular-nums',
        days < 0
          ? 'bg-rose-950 text-rose-300 ring-rose-800'
          : days === 0
            ? 'bg-gilt-400/15 text-gilt-300 ring-gilt-500/50'
            : 'bg-stage-850 text-ink-500 ring-stage-700'
      )}
    >
      {label}
    </span>
  )
}

function RiskPanel({ data }: { data: DashboardData }) {
  return (
    <Panel title="重要提醒與風險" icon={<AlertTriangle className="size-3.5" />}>
      {data.risks.length === 0 ? (
        <EmptyState
          title="目前沒有風險項目"
          description="逾期任務與阻塞階段會自動出現在這裡，不需要手動維護清單。"
          icon={<AlertTriangle aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.risks.map((risk) => (
            <li key={risk.id} className="flex items-start gap-2">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold',
                  risk.tone === 'high'
                    ? 'bg-rose-500/20 text-rose-300'
                    : risk.tone === 'medium'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-sky-500/20 text-sky-300'
                )}
              >
                !
              </span>
              <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-300">
                {risk.projectTitle && (
                  <span className="text-ink-500">{risk.projectTitle}：</span>
                )}
                {risk.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ActivityPanel({ data }: { data: DashboardData }) {
  return (
    <Panel title="近期動態" icon={<Activity className="size-3.5" />}>
      {data.recentActivity.length === 0 ? (
        <EmptyState title="尚無動態" className="py-8" />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {data.recentActivity.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-stage-800 text-ink-500 ring-1 ring-stage-700"
              >
                <Activity className="size-3" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs text-ink-200">{entry.summary}</span>
                <span className="text-[10px] text-ink-600">
                  {entry.userName}・{formatRelativeZh(entry.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
