import {
  Activity,
  Baseline,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Coins,
  FileText,
  Film,
  Image as ImageIcon,
  Inbox,
  Layers,
  ListChecks,
  Music,
  Play,
  Sparkles,
  Users,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { Chip, EpisodeStatusChip, MemberDot } from '@/components/ui/StatusChip'
import {
  AI_JOB_KIND_LABEL,
  ASSET_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  type AiJobKindValue,
  type AssetKindValue,
  type EpisodeStatusValue,
} from '@/lib/constants'
import type { ProjectOverview as ProjectOverviewData } from '@/lib/project-overview'
import { cn, formatBytes, formatRelativeZh } from '@/lib/utils'

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

type ProjectTab = { key: string; label: string; ready?: boolean; milestone?: string }

/** The eight views of a project. Only 總覽 exists; the rest are gated. */
const PROJECT_TABS: ProjectTab[] = [
  { key: 'overview', label: '總覽', ready: true },
  { key: 'script', label: '劇本', milestone: 'M2' },
  { key: 'storyboard', label: '分鏡', milestone: 'M3' },
  { key: 'assets', label: '素材', milestone: 'M3' },
  { key: 'production', label: '製作', milestone: 'M3' },
  { key: 'post', label: '後製', milestone: 'M3' },
  { key: 'release', label: '發行', milestone: 'M4' },
  { key: 'settings', label: '設定', milestone: 'M4' },
]

export function ProjectOverview({ project }: { project: ProjectOverviewData }) {
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <Hero project={project} />
      <TabStrip />
      <StatCards project={project} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <WorkflowPanel project={project} />
          <EpisodePanel project={project} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <AssetPanel project={project} />
          <AiStatsPanel project={project} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <TaskPanel project={project} />
          <ActivityPanel project={project} />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

function Hero({ project }: { project: ProjectOverviewData }) {
  return (
    <section className="panel relative overflow-hidden rounded-xl bg-stage-900 ring-1 ring-stage-700">
      {/* Key art goes here once a cover asset exists; a wash until then. */}
      <div aria-hidden className="art-placeholder absolute inset-0" />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-stage-950 via-stage-950/85 to-stage-950/30"
      />

      <div className="relative flex flex-col gap-3 p-4 sm:p-5">
        <nav aria-label="麵包屑" className="flex items-center gap-1.5 text-[11px] text-ink-500">
          <Link href="/projects" className="transition-colors hover:text-ink-200">
            作品列表
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <span className="truncate text-ink-200">{project.title}</span>
        </nav>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-ink-50 sm:text-2xl">
                {project.title}
              </h1>
              <Chip className={PROJECT_STATUS_STYLE[project.status]}>
                {PROJECT_STATUS_LABEL[project.status]}
              </Chip>
              {project.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-stage-800/80 px-1.5 py-0.5 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="max-w-2xl text-xs leading-relaxed text-ink-400">
              {project.logline || (
                <span className="text-ink-600">
                  尚未撰寫一句話簡介——待故事定稿後於「作品設定」填入。
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <GatedButton label="編輯作品" milestone="M1" icon={<FileText className="size-3.5" />} />
            <GatedButton
              label="AI 企劃助手"
              milestone="M2"
              icon={<Sparkles className="size-3.5" />}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * An action the design shows but that has no implementation yet.
 *
 * Spec v2 §4：「圖中按鈕必須真能操作；尚未串接的功能應禁用並顯示原因，不做空按鈕」—
 * so it renders disabled with its milestone rather than as a link to nowhere.
 */
function GatedButton({
  label,
  milestone,
  icon,
}: {
  label: string
  milestone: string
  icon: ReactNode
}) {
  return (
    <span
      aria-disabled="true"
      title={`「${label}」尚未實作，預計於 ${milestone} 階段交付`}
      className="inline-flex cursor-default items-center gap-1.5 rounded-lg bg-stage-800/80 px-3 py-2 text-xs font-medium text-ink-500 ring-1 ring-inset ring-stage-700 transition-colors select-none hover:text-ink-300"
    >
      {icon}
      {label}
      <span className="rounded bg-stage-900 px-1 text-[10px] text-ink-600">{milestone}</span>
    </span>
  )
}

function TabStrip() {
  return (
    <nav aria-label="作品分頁" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max items-center gap-1 rounded-xl bg-stage-900 p-1 ring-1 ring-stage-700">
        {PROJECT_TABS.map((tab) => (
          <li key={tab.key}>
            {tab.ready ? (
              <span
                aria-current="page"
                className="bg-brand-gradient glow-accent-sm inline-flex items-center rounded-lg px-3.5 py-1.5 text-xs font-medium text-white"
              >
                {tab.label}
              </span>
            ) : (
              <span
                aria-disabled="true"
                title={`「${tab.label}」尚未實作，預計於 ${tab.milestone} 階段交付`}
                className="inline-flex cursor-default items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs text-ink-600 transition-colors select-none hover:bg-stage-800/60 hover:text-ink-400"
              >
                {tab.label}
                <span className="text-[9px] text-ink-700">{tab.milestone}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}

/* -------------------------------------------------------------------------- */
/* Stat cards                                                                  */
/* -------------------------------------------------------------------------- */

function StatCards({ project }: { project: ProjectOverviewData }) {
  const pct = Math.round(project.progress * 100)
  const planned = project.plannedEpisodes || project.episodeCount

  const done = project.episodesByStatus.DONE ?? 0
  const inProgress =
    (project.episodesByStatus.WRITING ?? 0) +
    (project.episodesByStatus.STORYBOARD ?? 0) +
    (project.episodesByStatus.PRODUCTION ?? 0) +
    (project.episodesByStatus.REVIEW ?? 0)
  const waiting = (project.episodesByStatus.PLANNED ?? 0) + (project.episodesByStatus.ON_HOLD ?? 0)

  const spendPct =
    project.budgetUsd && project.budgetUsd > 0
      ? Math.round((project.spendUsd / project.budgetUsd) * 100)
      : null

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard icon={<Activity className="size-3.5" />} title="製作進度">
        <p className="text-2xl font-semibold text-ink-50">{pct}%</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stage-800">
          <div
            className={cn('h-full rounded-full', pct > 0 ? 'bg-brand-gradient' : '')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </StatCard>

      <StatCard icon={<Layers className="size-3.5" />} title="集數規劃">
        <p className="text-2xl font-semibold text-ink-50">
          {project.episodeCount}
          <span className="ml-1 text-sm font-normal text-ink-500">集</span>
        </p>
        <p className="mt-2 text-[11px] text-ink-500">
          已完成 {done}｜製作中 {inProgress}｜待製作 {waiting}
        </p>
      </StatCard>

      <StatCard icon={<CalendarDays className="size-3.5" />} title="預計時程">
        <p className="text-sm font-medium text-ink-100">
          {project.startDate || project.dueDate ? (
            <>
              {formatDate(project.startDate)} ~ {formatDate(project.dueDate)}
            </>
          ) : (
            <span className="text-ink-600">尚未設定起訖日</span>
          )}
        </p>
        <p className="mt-2 text-[11px] text-ink-500">
          {project.daysRemaining === null
            ? `規劃 ${planned} 集，每集 120–180 秒`
            : project.daysRemaining >= 0
              ? `剩餘 ${project.daysRemaining} 天`
              : `已逾期 ${Math.abs(project.daysRemaining)} 天`}
        </p>
      </StatCard>

      <StatCard icon={<Coins className="size-3.5" />} title="製作預算">
        <p className="text-xl font-semibold text-ink-50">
          {project.budgetUsd ? `US$${project.budgetUsd.toLocaleString('en-US')}` : '未設定'}
        </p>
        <p className="mt-2 text-[11px] text-ink-500">
          已支出 US${project.spendUsd.toFixed(2)}
          {spendPct !== null && `（${spendPct}%）`}
        </p>
        {spendPct !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stage-800">
            <div
              className={cn(
                'h-full rounded-full',
                spendPct > 90 ? 'bg-rose-500' : spendPct > 70 ? 'bg-amber-500' : 'bg-accent-500'
              )}
              style={{ width: `${Math.min(spendPct, 100)}%` }}
            />
          </div>
        )}
      </StatCard>

      <StatCard icon={<Users className="size-3.5" />} title="主要負責">
        <div className="flex flex-col gap-2">
          <MemberLine member={project.owner} fallback="未指定負責人" />
          <MemberLine member={project.techLead} fallback="未指定技術支援" />
        </div>
      </StatCard>
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

function MemberLine({
  member,
  fallback,
}: {
  member: { name: string; title: string; color: string } | null
  fallback: string
}) {
  if (!member) return <p className="text-[11px] text-ink-600">{fallback}</p>

  return (
    <div className="flex min-w-0 items-center gap-2">
      <MemberDot name={member.name} color={member.color} />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-ink-100">{member.name}</span>
        <span className="truncate text-[10px] text-ink-500">{member.title}</span>
      </div>
    </div>
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
    <Panel title="製作流程（工作流）" icon={<Baseline className="size-3.5" />}>
      {/* Horizontal on wide screens, vertical on a phone — seven labelled
          nodes do not fit across 390px without shrinking the text to nothing. */}
      <ol className="flex flex-col gap-0 sm:flex-row sm:items-start">
        {project.workflow.map((step, index) => {
          const last = index === project.workflow.length - 1
          return (
            <li
              key={step.key}
              className="flex gap-3 sm:min-w-0 sm:flex-1 sm:flex-col sm:items-center sm:gap-1.5"
            >
              <div className="flex flex-col items-center sm:w-full sm:flex-row">
                {/* Left rail on phone / connecting line on desktop. */}
                <span
                  aria-hidden
                  className={cn(
                    'hidden h-0.5 flex-1 sm:block',
                    index === 0
                      ? 'bg-transparent'
                      : project.workflow[index - 1]?.state === 'DONE'
                        ? 'bg-emerald-600'
                        : 'bg-stage-700'
                  )}
                />
                <StepNode state={step.state} />
                <span
                  aria-hidden
                  className={cn(
                    'hidden h-0.5 flex-1 sm:block',
                    last
                      ? 'bg-transparent'
                      : step.state === 'DONE'
                        ? 'bg-emerald-600'
                        : 'bg-stage-700'
                  )}
                />
                {/* Vertical connector, phone only. */}
                {!last && <span aria-hidden className="w-0.5 flex-1 bg-stage-700 sm:hidden" />}
              </div>

              <div className="flex min-w-0 flex-col pb-4 sm:items-center sm:pb-0">
                <span
                  className={cn(
                    'truncate text-[11px] font-medium',
                    step.state === 'DONE'
                      ? 'text-emerald-300'
                      : step.state === 'ACTIVE'
                        ? 'text-accent-300'
                        : 'text-ink-600'
                  )}
                >
                  {step.label}
                </span>
                <span className="text-[10px] text-ink-600">
                  {step.progress > 0 ? `${Math.round(step.progress * 100)}%` : '未開始'}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

function StepNode({ state }: { state: 'DONE' | 'ACTIVE' | 'PENDING' }) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full ring-1',
        state === 'DONE'
          ? 'bg-emerald-600 text-white ring-emerald-400/60'
          : state === 'ACTIVE'
            ? 'bg-accent-600 text-white ring-accent-400/60 glow-accent-sm'
            : 'bg-stage-800 text-ink-600 ring-stage-700'
      )}
    >
      {state === 'DONE' ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Play aria-hidden className="size-3" />
      )}
    </span>
  )
}

function EpisodePanel({ project }: { project: ProjectOverviewData }) {
  return (
    <Panel
      title={`分集列表（${project.episodeCount} 集）`}
      icon={<Film className="size-3.5" />}
      action={<GatedAction label="管理集數" milestone="M1" />}
      bodyClassName=""
    >
      {project.episodes.length === 0 ? (
        <EmptyState
          title="尚未建立集數"
          description="建立集數後，這裡會列出每一集的狀態與進度。"
          icon={<Film aria-hidden className="size-5 text-ink-500" />}
          className="py-10"
        />
      ) : (
        <>
          {/* Table on tablet and up; stacked rows on a phone, where five
              columns would each be a few characters wide. */}
          <div className="hidden sm:block">
            {/*
              table-fixed with explicit widths: left to itself the browser
              gives the four short columns what they ask for and squeezes the
              title down to「未…」.
            */}
            <table className="w-full table-fixed text-left text-xs">
              <thead className="text-[10px] text-ink-600">
                <tr className="border-b border-stage-700/60">
                  <th scope="col" className="w-[4.5rem] px-4 py-2 font-medium">
                    集數
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    標題
                  </th>
                  <th scope="col" className="w-20 px-2 py-2 font-medium">
                    狀態
                  </th>
                  <th scope="col" className="w-24 px-2 py-2 font-medium">
                    進度
                  </th>
                  <th scope="col" className="w-24 px-4 py-2 text-right font-medium">
                    截止日
                  </th>
                </tr>
              </thead>
              <tbody>
                {project.episodes.map((episode) => (
                  <tr key={episode.id} className="border-b border-stage-800/70 last:border-0">
                    <td className="px-4 py-2 font-medium text-ink-300 tabular-nums">
                      EP{String(episode.number).padStart(3, '0')}
                    </td>
                    <td className="px-2 py-2">
                      <span className="block truncate text-ink-200">
                        {episode.title || <span className="text-ink-600">未命名</span>}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <EpisodeStatusChip status={episode.status as EpisodeStatusValue} />
                    </td>
                    <td className="px-2 py-2">
                      <MiniBar value={episode.progress} />
                    </td>
                    <td className="px-4 py-2 text-right text-ink-500 tabular-nums">
                      {episode.dueDate ? formatDate(episode.dueDate) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col sm:hidden">
            {project.episodes.map((episode) => (
              <li
                key={episode.id}
                className="flex flex-col gap-1.5 border-b border-stage-800/70 px-4 py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-ink-300 tabular-nums">
                    EP{String(episode.number).padStart(3, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                    {episode.title || <span className="text-ink-600">未命名</span>}
                  </span>
                  <EpisodeStatusChip status={episode.status as EpisodeStatusValue} />
                </div>
                <MiniBar value={episode.progress} />
              </li>
            ))}
          </ul>

          {project.episodeCount > project.episodes.length && (
            <p className="px-4 py-2.5 text-center text-[11px] text-ink-600">
              僅顯示前 {project.episodes.length} 集，其餘 {project.episodeCount -
                project.episodes.length}{' '}
              集待「集數列表」頁完成後檢視（M1）
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
