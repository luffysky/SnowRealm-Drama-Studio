import { Flag, Layers, PieChart, TrendingUp } from 'lucide-react'
import { LiveData } from '@/components/studio/LiveData'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { EpisodeManager } from '@/components/studio/EpisodeManager'
import { EmptyState } from '@/components/ui/StateViews'
import { getSessionUser } from '@/lib/auth/session'
import { EPISODE_STATUSES, type EpisodeStatusValue } from '@/lib/constants'
import {
  episodeSegments,
  getEpisodeDetail,
  listEpisodes,
  parsePerPage,
  parseSort,
  parseView,
  stageCompletion,
  type EpisodeRow,
} from '@/lib/episodes'
import { requireProjectPage } from '@/lib/project-access'
import {
  PRODUCTION_STAGE_KEYS,
  PRODUCTION_STAGE_LABEL,
  stageOrdinal,
  toPercent,
  type ProductionStageKey,
} from '@/lib/production'
import { getProductionProgress, type ProductionProgress } from '@/lib/production-progress'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: '製作進度' }

type Params = {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

/**
 * 17 製作進度管理 (design 17 v2).
 *
 * The episode table is `EpisodeManager`, the same component 集數管理 uses. The
 * two pages ask the same question of the same data — which episodes, in what
 * order, at what stage — and keeping one implementation is what stops them
 * disagreeing about a number the spec requires to match (§11.4 case 5).
 */
export default async function ProductionPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
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

  const [progress, result] = await Promise.all([
    getProductionProgress(project.id),
    listEpisodes(project.id, {
      page: Number(one(sp.page)) || 1,
      perPage: parsePerPage(one(sp.per)),
      search: one(sp.q),
      status,
      stage,
      sort: parseSort(one(sp.sort)),
    }),
  ])

  const selectedId = one(sp.ep)
  const selected = selectedId
    ? await getEpisodeDetail(project.id, selectedId)
    : (result.rows[0] ?? null)

  /*
   * 另外兩種檢視要的彙總，只在用到的時候查 (Z197)。
   *
   * 集數管理頁有查有傳，這一頁沒有——而四顆檢視切換鍵是無條件畫出來的，兩個
   * prop 的預設值又是 `[]`。所以在這一頁按「分段檢視」，表格上方明明列著集
   * 數，下面寫「還沒有集數。」；按「進度總覽」則九大階段的欄位整排消失。兩
   * 種都不是空資料，是沒把資料傳下去。
   *
   * 兩份都是跨全部集數的——列表一次只看得到二十筆，而「做到哪裡了」是整體的
   * 問題；列表與卡片檢視用不到，所以不查。
   */
  const view = parseView(one(sp.view))
  const [stageColumns, segments] =
    view === 'PROGRESS'
      ? [await stageCompletion(project.id), []]
      : view === 'SEGMENT'
        ? [[], await episodeSegments(project.id)]
        : [[], []]

  return (
    <div className="flex flex-col">
      {/* 數字自己跟上，不用手動重新整理 (Z117)。 */}
      <LiveData />
      <div className="flex flex-col gap-4 p-3 pb-0 sm:p-4 sm:pb-0 lg:p-6 lg:pb-0">
        <SubTabs />

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
          <StagePanel progress={progress} />
          <TrendPanel progress={progress} />
          <div className="flex min-w-0 flex-col gap-4">
            <DistributionPanel progress={progress} />
            <MilestonePanel progress={progress} />
          </div>
        </div>
      </div>

      <EpisodeManager
        projectId={project.id}
        result={{ ...result, rows: result.rows.map(serialise) }}
        selected={selected ? serialise(selected) : null}
        view={view}
        stageColumns={stageColumns}
        segments={segments}
        search={one(sp.q)}
        status={status ?? ''}
        stage={stage ?? ''}
        sort={parseSort(one(sp.sort))}
        heading="集數製作進度"
      />
    </div>
  )
}

function serialise(row: EpisodeRow) {
  return {
    ...row,
    dueDate: row.dueDate?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/* -------------------------------------------------------------------------- */

type SubTab = { key: string; label: string; ready?: boolean; milestone?: string }

/** The six views of the progress page. Only 總覽 is built. */
const SUB_TABS: SubTab[] = [
  { key: 'overview', label: '總覽', ready: true },
  { key: 'table', label: '進度表', milestone: 'M1' },
  { key: 'gantt', label: '甘特圖', milestone: 'M4' },
  { key: 'resources', label: '資源配置', milestone: 'M4' },
  { key: 'milestones', label: '里程碑', milestone: 'M4' },
  { key: 'risks', label: '風險監控', milestone: 'M4' },
]

function SubTabs() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold text-ink-100">製作進度管理</h2>

      <nav aria-label="進度檢視" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max items-center gap-1 rounded-xl bg-stage-900 p-1 ring-1 ring-stage-700">
          {SUB_TABS.map((tab) =>
            tab.ready ? (
              <li key={tab.key}>
                <span
                  aria-current="page"
                  className="bg-brand-gradient glow-accent-sm inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                >
                  {tab.label}
                </span>
              </li>
            ) : (
              <li key={tab.key}>
                <span
                  aria-disabled="true"
                  title={`「${tab.label}」尚未實作，預計於 ${tab.milestone} 階段交付`}
                  className="inline-flex cursor-default items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-ink-600 select-none hover:text-ink-400"
                >
                  {tab.label}
                  <span className="text-[9px] text-ink-700">{tab.milestone}</span>
                </span>
              </li>
            )
          )}
        </ul>
      </nav>
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
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-ink-200">{title}</h3>
        {action}
      </header>
      <div className="min-w-0 flex-1 p-4">{children}</div>
    </section>
  )
}

function StagePanel({ progress }: { progress: ProductionProgress }) {
  return (
    <Panel
      title={`九大階段完成率（全部 ${progress.stageRecords.toLocaleString('en-US')} 筆）`}
      icon={<Layers className="size-3.5" />}
    >
      <ul className="flex flex-col gap-2">
        {progress.stageCompletion.map((stage) => (
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
                style={{ width: `${toPercent(stage.progress)}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-[10px] text-ink-300 tabular-nums">
              {toPercent(stage.progress)}%
            </span>
            <span className="hidden w-16 shrink-0 text-right text-[10px] text-ink-600 tabular-nums sm:inline">
              ({stage.done} / {stage.total})
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function TrendPanel({ progress }: { progress: ProductionProgress }) {
  const max = Math.max(1, ...progress.trend.map((p) => p.completed + p.started))

  return (
    <Panel title="製作進度趨勢（近 30 天）" icon={<TrendingUp className="size-3.5" />}>
      {progress.trend.length === 0 ? (
        <EmptyState
          title="尚無進度變更紀錄"
          description={
            progress.hasTrendHistory
              ? '近 30 天內沒有階段異動。'
              : '趨勢只從階段異動的稽核紀錄繪製，不會從目前狀態回推。'
          }
          icon={<TrendingUp aria-hidden className="size-5 text-ink-500" />}
          className="py-10"
        />
      ) : (
        <div className="flex h-44 items-end gap-1">
          {progress.trend.map((point) => (
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

function DistributionPanel({ progress }: { progress: ProductionProgress }) {
  const stats = progress.episodeStats
  const pctOf = (n: number) => (stats.total > 0 ? `${((n / stats.total) * 100).toFixed(1)}%` : '—')

  const slices = [
    { label: '已完成', value: stats.done, dot: 'text-emerald-400' },
    { label: '進行中', value: stats.inProgress, dot: 'text-accent-400' },
    { label: '待處理', value: stats.pending, dot: 'text-ink-600' },
  ]

  return (
    <Panel title="集數分佈（依製作狀態）" icon={<PieChart className="size-3.5" />}>
      <div className="flex items-center gap-3">
        <div className="relative size-16 shrink-0">
          <svg viewBox="0 0 56 56" className="size-full -rotate-90" aria-hidden>
            <circle cx="28" cy="28" r="22" fill="none" strokeWidth="7" className="stroke-stage-800" />
            {stats.total > 0 &&
              (() => {
                const circumference = 2 * Math.PI * 22
                let offset = 0
                return slices.map((slice, index) => {
                  const length = (slice.value / stats.total) * circumference
                  const element = (
                    <circle
                      key={slice.label}
                      cx="28"
                      cy="28"
                      r="22"
                      fill="none"
                      strokeWidth="7"
                      className={cn(
                        index === 0
                          ? 'stroke-emerald-500'
                          : index === 1
                            ? 'stroke-accent-500'
                            : 'stroke-stage-700'
                      )}
                      strokeDasharray={`${length.toFixed(2)} ${(circumference - length).toFixed(2)}`}
                      strokeDashoffset={(-offset).toFixed(2)}
                    />
                  )
                  offset += length
                  return element
                })
              })()}
          </svg>
          <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-ink-50 tabular-nums">
            {stats.total}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {slices.map((slice) => (
            <div key={slice.label} className="flex items-center gap-1.5 text-[10px]">
              <span aria-hidden className={cn('text-[8px]', slice.dot)}>
                ●
              </span>
              <span className="text-ink-500">{slice.label}</span>
              <span className="ml-auto text-ink-300 tabular-nums">{slice.value}</span>
              <span className="w-11 text-right text-ink-600 tabular-nums">
                {pctOf(slice.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function MilestonePanel({ progress }: { progress: ProductionProgress }) {
  return (
    <Panel title="里程碑進度" icon={<Flag className="size-3.5" />}>
      {progress.milestones.length === 0 ? (
        <EmptyState
          title="尚未設定里程碑"
          description="例如「EP001–EP020 於 11/30 前完成分鏡」。建立後這裡會顯示該範圍的實際進度。"
          icon={<Flag aria-hidden className="size-5 text-ink-500" />}
          className="py-6"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {progress.milestones.slice(0, 3).map((milestone) => (
            <li key={milestone.id} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-300">
                  {milestone.title}
                </span>
                {milestone.targetDate && (
                  <span className="shrink-0 text-[10px] text-ink-600 tabular-nums">
                    {new Intl.DateTimeFormat('zh-TW', {
                      month: '2-digit',
                      day: '2-digit',
                      timeZone: 'Asia/Taipei',
                    }).format(milestone.targetDate)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
                  <div
                    className="bg-brand-gradient h-full rounded-full"
                    style={{ width: `${toPercent(milestone.progress)}%` }}
                  />
                </div>
                <span className="shrink-0 text-[10px] text-ink-300 tabular-nums">
                  {toPercent(milestone.progress)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
