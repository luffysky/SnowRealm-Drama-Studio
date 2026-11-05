import {
  Activity,
  AlertTriangle,
  Baseline,
  Boxes,
  Clapperboard,
  ClipboardList,
  Clock,
  Coins,
  Film,
  Image as ImageIcon,
  Inbox,
  Layers,
  ListChecks,
  Music,
  Sparkles,
  Users,
  Video,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { EpisodeStatusChip } from '@/components/ui/StatusChip'
import {
  AI_JOB_KIND_LABEL,
  ASSET_KIND_LABEL,
  type AiJobKindValue,
  type AssetKindValue,
  type EpisodeStatusValue,
} from '@/lib/constants'
import {
  conversionNote,
  formatFromBase,
  type CurrencyValue,
  type FxRates,
} from '@/lib/money'
import type { ProjectOverview as ProjectOverviewData } from '@/lib/project-overview'
import { STAGES_PER_EPISODE, toPercent } from '@/lib/production'
import { cn, formatBytes, formatRelativeZh } from '@/lib/utils'
import { assetPreviewUrl } from '@/lib/asset-url'

/**
 * 作品總覽 (design 04).
 *
 * A server component: every number here comes from `getProjectOverview` and
 * nothing on the page is interactive yet, so shipping no JavaScript for it is
 * both simpler and faster.
 *
 * Where a section has no data the panel says so rather than drawing an empty
 * chart. The reference art shows a project mid-flight — 482 images, 26,340
 * generated characters, six open tasks — and none of that exists yet. Spec v2
 * §0 forbids seeding those figures, so the layout has to read correctly at
 * zero as well as at full tilt.
 */

export function ProjectOverview({
  project,
  currency,
  fx,
  ai,
}: {
  project: ProjectOverviewData
  currency: CurrencyValue
  fx: FxRates
  /** 頁面組好的 AI 發動鈕，渲染在標題列右邊 (Z153)。 */
  ai?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <OverviewHeading project={project} ai={ai} />
      <KpiRow project={project} currency={currency} fx={fx} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <WorkflowPanel project={project} />

        <div className="flex min-w-0 flex-col gap-4">
          <EpisodePanel project={project} />

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TaskPanel project={project} />
            <RiskPanel project={project} />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <AssetPanel project={project} />
        <AiStatsPanel project={project} />
        <ActivityPanel project={project} />
      </div>
    </div>
  )
}

/**
 * 作品總覽 plus the facts that identify this project.
 *
 * The title, cover, status, tags and logline are not repeated here: they live
 * in the workspace header, which every tab shares.
 */
function OverviewHeading({
  project,
  ai,
}: {
  project: ProjectOverviewData
  ai?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
        <Clapperboard aria-hidden className="size-4 text-accent-400" />
        作品總覽
      </h2>

      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-ink-500">
        <div className="flex gap-1">
          <dt>建立</dt>
          <dd className="text-ink-300">{formatDate(project.createdAt)}</dd>
        </div>
        {project.tags[0] && (
          <div className="flex gap-1">
            <dt>主類型</dt>
            <dd className="text-ink-300">{project.tags[0]}</dd>
          </div>
        )}
      </dl>

      {/*
        作品企劃生成 (Z153)。總覽是它唯一說得通的位置：這個任務談的是整部作
        品的賣點、受眾與分部規劃，不是某一集的事。
      */}
      {ai && <div className="ml-auto flex items-center gap-2">{ai}</div>}
    </div>
  )
}

/**
 * The four headline figures.
 *
 * The donut buckets stage *records* by status, so the legend adds up to
 * 集數 x 9. The completion percentage beside it comes from the weighted
 * contract and is deliberately not the same number — a stage at 60% is one
 * in-progress record but 0.6 of a completed equivalent — so the card says so
 * rather than letting the two look like one figure printed twice.
 */
function KpiRow({
  project,
  currency,
  fx,
}: {
  project: ProjectOverviewData
  currency: CurrencyValue
  fx: FxRates
}) {
  const totals = project.stageTotals
  const pct = toPercent(project.progress)

  const slices = [
    { key: 'completed', label: '已完成', value: totals.completed, className: 'text-emerald-400' },
    { key: 'inProgress', label: '進行中', value: totals.inProgress, className: 'text-accent-400' },
    { key: 'pending', label: '待處理', value: totals.pending, className: 'text-ink-600' },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard icon={<Layers className="size-3.5" />} title="總集數">
        <p className="text-2xl font-semibold text-ink-50">
          {project.episodeCount}
          <span className="ml-1 text-sm font-normal text-ink-500">集</span>
        </p>
        <p className="mt-1 text-[11px] text-ink-600">
          {project.plannedEpisodes > 0 ? `規劃 ${project.plannedEpisodes} 集` : '尚未規劃集數'}
        </p>
      </StatCard>

      <StatCard icon={<ClipboardList className="size-3.5" />} title="製作階段紀錄">
        <p className="text-2xl font-semibold text-ink-50">
          {totals.total.toLocaleString('en-US')}
          <span className="ml-1 text-sm font-normal text-ink-500">筆</span>
        </p>
        <p className="mt-1 text-[11px] text-ink-600">
          {project.episodeCount} 集 x {STAGES_PER_EPISODE} 階段
        </p>
      </StatCard>

      <StatCard icon={<Activity className="size-3.5" />} title="整體完成率">
        <div className="flex items-center gap-3">
          <Donut fraction={project.progress} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {slices.map((slice) => (
              <div key={slice.key} className="flex items-center gap-1.5 text-[10px]">
                <span aria-hidden className={cn('text-[8px]', slice.className)}>
                  ●
                </span>
                <span className="text-ink-500">{slice.label}</span>
                <span className="ml-auto text-ink-300 tabular-nums">
                  {slice.value.toLocaleString('en-US')}
                </span>
                <span className="w-11 text-right text-ink-600 tabular-nums">
                  {totals.total > 0 ? `${((slice.value / totals.total) * 100).toFixed(1)}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-700">
          完成率 {pct}% 以已驗證進度加權，與上方筆數不是同一個數字
        </p>
      </StatCard>

      <StatCard icon={<Coins className="size-3.5" />} title="製作預算">
        <p className="text-xl font-semibold text-ink-50">
          {project.budget ? formatFromBase(project.budget, currency, fx) : '未設定'}
        </p>
        <p className="mt-1 text-[11px] text-ink-500">
          已支出 {formatFromBase(project.spend, currency, fx)}
        </p>
        {conversionNote(currency, fx) && (
          <p className="mt-1 text-[10px] text-ink-600">{conversionNote(currency, fx)}</p>
        )}
      </StatCard>
    </div>
  )
}

/**
 * Completion ring.
 *
 * Pure SVG: a charting library for one arc would cost hundreds of kilobytes to
 * draw what `stroke-dasharray` already does.
 */
function Donut({ fraction }: { fraction: number }) {
  const pct = toPercent(fraction)
  const radius = 22
  const circumference = 2 * Math.PI * radius
  const filled = circumference * Math.min(Math.max(fraction, 0), 1)

  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 56 56" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="7"
          className="stroke-stage-800"
        />
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
        {pct}%
      </span>
    </div>
  )
}

function StatCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="panel flex flex-col rounded-xl bg-stage-900 p-3.5 ring-1 ring-stage-700">
      <h2 className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
        <span aria-hidden className="text-accent-400">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                      */
/* -------------------------------------------------------------------------- */

function Panel({
  title,
  icon,
  action,
  children,
  bodyClassName,
}: {
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
  bodyClassName?: string
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
      <div className={cn('min-w-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  )
}

/** A header action that is not built yet. */
function GatedAction({ label, milestone }: { label: string; milestone: string }) {
  return (
    <span
      aria-disabled="true"
      title={`「${label}」尚未實作，預計於 ${milestone} 階段交付`}
      className="inline-flex shrink-0 cursor-default items-center gap-1 text-[11px] text-ink-600 select-none hover:text-ink-400"
    >
      {label}
      <span className="text-[9px] text-ink-700">{milestone}</span>
    </span>
  )
}

function WorkflowPanel({ project }: { project: ProjectOverviewData }) {
  return (
    <Panel title="九階段製作流程" icon={<Baseline className="size-3.5" />}>
      {/*
        A row per stage rather than a horizontal pipeline: nine labelled nodes
        do not fit across a phone, and each stage now carries a real figure
        (how many of the N episodes have cleared it) that a node cannot show.
      */}
      <ul className="flex flex-col gap-2">
        {project.workflow.map((step) => (
          <li key={step.key} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-[10px] text-ink-700 tabular-nums">
              {step.ordinal}
            </span>
            <span
              className={cn(
                'w-16 shrink-0 truncate text-[11px]',
                step.state === 'DONE'
                  ? 'text-emerald-300'
                  : step.state === 'ACTIVE'
                    ? 'text-accent-300'
                    : 'text-ink-500'
              )}
            >
              {step.label}
            </span>

            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  step.state === 'DONE' ? 'bg-emerald-500' : 'bg-brand-gradient'
                )}
                style={{ width: `${toPercent(step.progress)}%` }}
              />
            </div>

            <span className="w-10 shrink-0 text-right text-[10px] text-ink-400 tabular-nums">
              {toPercent(step.progress)}%
            </span>
            <span className="hidden w-16 shrink-0 text-right text-[10px] text-ink-600 tabular-nums sm:inline">
              {step.episodesDone} / {step.episodeCount}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function EpisodePanel({ project }: { project: ProjectOverviewData }) {
  const shown = project.episodes.length
  const remaining = Math.max(project.episodeCount - shown, 0)

  return (
    <Panel
      title="集數進度概覽"
      icon={<Film className="size-3.5" />}
      action={
        project.episodeCount > 0 ? (
          /*
           * spec v3 §11.3: the overview shows at most eight cards and must
           * offer a way to the full list. Never let these look like all of it.
           */
          <GatedAction label={`查看全部 ${project.episodeCount} 集`} milestone="M1" />
        ) : undefined
      }
    >
      {shown === 0 ? (
        <EmptyState
          title="尚未建立集數"
          description="建立集數後，這裡會顯示最近與重點集數的狀態。"
          icon={<Film aria-hidden className="size-5 text-ink-500" />}
          className="py-10"
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {project.episodes.map((episode) => (
              <li
                key={episode.id}
                className="panel flex flex-col overflow-hidden rounded-lg bg-stage-850 ring-1 ring-stage-700"
              >
                <div className="relative aspect-video w-full">
                  {episode.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPreviewUrl(episode.coverAssetId)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <div aria-hidden className="art-placeholder absolute inset-0" />
                  )}
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-stage-950/90 to-transparent"
                  />
                  <span className="absolute bottom-1.5 left-2 text-[11px] font-medium text-ink-50 tabular-nums">
                    EP{String(episode.number).padStart(3, '0')}
                  </span>
                  <span className="absolute right-1.5 bottom-1.5">
                    <EpisodeStatusChip status={episode.status as EpisodeStatusValue} />
                  </span>
                </div>

                <div className="flex flex-col gap-1 p-2">
                  <span className="truncate text-[11px] text-ink-300">
                    {episode.title || <span className="text-ink-600">未命名</span>}
                  </span>
                  <MiniBar value={episode.progress} />
                </div>
              </li>
            ))}
          </ul>

          {remaining > 0 && (
            <p className="mt-3 text-center text-[11px] text-ink-600">
              另有 {remaining} 集未顯示，完整清單待「集數管理」頁完成（M1）
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

function MiniBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800"
      >
        <div
          className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-accent-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] text-ink-500 tabular-nums">{pct}%</span>
    </div>
  )
}

/** Icon per asset tile. */
const ASSET_TILE_ICON: Record<string, ReactNode> = {
  IMAGE: <ImageIcon className="size-4" />,
  VIDEO: <Video className="size-4" />,
  AUDIO: <Music className="size-4" />,
  CHARACTER: <Users className="size-4" />,
  WORLD: <Layers className="size-4" />,
  OTHER: <Boxes className="size-4" />,
}

function AssetPanel({ project }: { project: ProjectOverviewData }) {
  const byKind = new Map(project.assets.map((row) => [row.kind as AssetKindValue, row.count]))
  const sum = (...kinds: AssetKindValue[]) =>
    kinds.reduce((total, kind) => total + (byKind.get(kind) ?? 0), 0)

  /**
   * Six tiles, as in the design. 角色 and 世界觀 are not asset kinds — they are
   * their own tables — but they belong here, because this panel answers "what
   * material does this show have", not "what is in the bucket".
   */
  const tiles = [
    { key: 'IMAGE', label: ASSET_KIND_LABEL.IMAGE, value: sum('IMAGE', 'STICKER') },
    { key: 'VIDEO', label: ASSET_KIND_LABEL.VIDEO, value: sum('VIDEO') },
    { key: 'AUDIO', label: '音檔', value: sum('MUSIC', 'VOICE', 'SFX') },
    { key: 'CHARACTER', label: '角色', value: project.library.characters },
    { key: 'WORLD', label: '世界觀', value: project.library.worldEntries },
    { key: 'OTHER', label: '其他', value: sum('NOVEL_ATTACHMENT', 'DOC', 'OTHER') },
  ]

  return (
    <Panel
      title="素材資產"
      icon={<Boxes className="size-3.5" />}
      action={
        <span className="shrink-0 text-[11px] text-ink-500">
          共 {project.assetTotals.count.toLocaleString('en-US')} 個檔案 /{' '}
          {formatBytes(project.assetTotals.bytes)}
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="flex flex-col items-center gap-1 rounded-lg bg-stage-850 px-2 py-3 ring-1 ring-inset ring-stage-700"
          >
            <span aria-hidden className={tile.value > 0 ? 'text-accent-400' : 'text-ink-700'}>
              {ASSET_TILE_ICON[tile.key]}
            </span>
            <span className="truncate text-[10px] text-ink-500">{tile.label}</span>
            <span
              className={cn(
                'text-sm font-semibold tabular-nums',
                tile.value > 0 ? 'text-ink-100' : 'text-ink-700'
              )}
            >
              {tile.value}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function AiStatsPanel({ project }: { project: ProjectOverviewData }) {
  const totalJobs = project.aiStats.reduce((total, row) => total + row.jobs, 0)
  const maxJobs = Math.max(1, ...project.aiStats.map((row) => row.jobs))

  return (
    <Panel title="AI 生成統計（本作品）" icon={<Sparkles className="size-3.5" />}>
      {totalJobs === 0 ? (
        <EmptyState
          title="尚未執行 AI 任務"
          description="串接供應商並送出第一個任務後，這裡會依類型統計次數與輸出 token。"
          icon={<Sparkles aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {project.aiStats.map((row) => (
            <li key={row.kind} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-[11px] text-ink-400">
                {AI_JOB_KIND_LABEL[row.kind as AiJobKindValue] ?? row.kind}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
                <div
                  className="bg-brand-gradient h-full rounded-full"
                  style={{ width: `${Math.round((row.jobs / maxJobs) * 100)}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-[11px] text-ink-300 tabular-nums">
                {row.jobs} 次
              </span>
            </li>
          ))}
          <li className="mt-1 border-t border-stage-700/60 pt-2 text-right text-[10px] text-ink-600">
            累計輸出{' '}
            {project.aiStats
              .reduce((total, row) => total + row.outputTokens, 0)
              .toLocaleString('en-US')}{' '}
            tokens
          </li>
        </ul>
      )}
    </Panel>
  )
}

function TaskPanel({ project }: { project: ProjectOverviewData }) {
  return (
    <Panel
      title={`待辦任務（${project.tasks.length}）`}
      icon={<ListChecks className="size-3.5" />}
      action={<GatedAction label="新增任務" milestone="M4" />}
    >
      {project.tasks.length === 0 ? (
        <EmptyState
          title="目前沒有待辦任務"
          description="任務看板於 M4 階段交付，屆時可在此指派與追蹤。"
          icon={<ListChecks aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {project.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
              <span
                aria-hidden
                className="size-3.5 shrink-0 rounded border border-stage-600 bg-stage-850"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-200">{task.title}</span>
              <DueChip due={task.dueDate} days={task.dueInDays} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * Due-date pill: today and overdue are called out, everything else is plain.
 *
 * `days` is computed in the data layer rather than here — reading the clock
 * during render makes the component impure and, on a page that is server
 * rendered then hydrated, is a hydration mismatch waiting to happen.
 */
function DueChip({ due, days }: { due: Date | null; days: number | null }) {
  if (!due || days === null) return <span className="shrink-0 text-[10px] text-ink-700">未定</span>

  const label = days === 0 ? '今日' : days < 0 ? `逾期 ${Math.abs(days)} 天` : formatDate(due)

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

/**
 * 關鍵風險與提醒.
 *
 * Derived from facts in the database, never from a hand-kept list: an overdue
 * task is overdue because its due date has passed, and a stage is flagged
 * because somebody set it to `blocked`. With nothing wrong the panel says so
 * instead of inventing a warning to fill the space.
 */
function RiskPanel({ project }: { project: ProjectOverviewData }) {
  const overdue = project.tasks.filter((t) => t.dueInDays !== null && t.dueInDays < 0)
  const dueToday = project.tasks.filter((t) => t.dueInDays === 0)
  const blocked = project.workflow.filter((s) => s.state === 'ACTIVE' && s.progress === 0)

  const risks: { id: string; tone: 'high' | 'medium' | 'info'; text: string }[] = []

  for (const task of overdue) {
    risks.push({
      id: `overdue-${task.id}`,
      tone: 'high',
      text: `${task.title}（逾期 ${Math.abs(task.dueInDays!)} 天）`,
    })
  }
  for (const task of dueToday) {
    risks.push({ id: `today-${task.id}`, tone: 'medium', text: `${task.title}（今日到期）` })
  }
  if (project.budget && project.spend / project.budget >= 0.8) {
    risks.push({
      id: 'budget',
      tone: 'medium',
      text: `製作預算已使用 ${Math.round((project.spend / project.budget) * 100)}%`,
    })
  }
  if (project.assetTotals.count === 0 && blocked.length > 0) {
    risks.push({
      id: 'assets',
      tone: 'info',
      text: '尚未上傳任何素材，後續階段會卡在素材製作',
    })
  }

  return (
    <Panel title="關鍵風險與提醒" icon={<AlertTriangle className="size-3.5" />}>
      {risks.length === 0 ? (
        <EmptyState
          title="目前沒有逾期或風險項目"
          description="逾期任務、預算超支與阻塞階段會自動出現在這裡。"
          icon={<AlertTriangle aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {risks.slice(0, 6).map((risk) => (
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
                {risk.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ActivityPanel({ project }: { project: ProjectOverviewData }) {
  return (
    <Panel
      title="近期動態"
      icon={<Clock className="size-3.5" />}
      action={<GatedAction label="查看全部" milestone="M4" />}
    >
      {project.recentActivity.length === 0 ? (
        <EmptyState
          title="尚無動態"
          description="成員的編輯與 AI 任務完成後會記錄在這裡。"
          icon={<Inbox aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {project.recentActivity.map((entry) => (
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

/* -------------------------------------------------------------------------- */

/**
 * Fixed `zh-TW` so the server and the browser cannot disagree about the
 * format and trip a hydration mismatch.
 */
function formatDate(value: Date | null): string {
  if (!value) return '未定'
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei',
  }).format(value)
}
