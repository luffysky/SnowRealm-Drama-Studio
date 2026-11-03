'use client'

import Link from 'next/link'
import {
  ArrowRight,
  CalendarDays,
  Coins,
  LayoutGrid,
  List,
  Plus,
  Search,
  UserRound,
  Wrench,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { ProjectCard, type ProjectCardData } from '@/components/studio/ProjectCard'
import { EmptyState } from '@/components/ui/StateViews'
import {
  PROJECT_SORT_LABEL,
  PROJECT_SORTS,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  PROJECT_STATUSES,
  type ProjectSortValue,
  type ProjectStatusValue,
} from '@/lib/constants'
import { formatFromBase, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn, formatRelativeZh } from '@/lib/utils'

/**
 * 作品列表 (design 03): filter pills, filter bar, card grid, detail rail.
 *
 * Filtering and sorting happen client-side. With two members and a handful of
 * projects the whole list fits in one payload, so a round-trip per keystroke
 * would add latency without reducing work. If the catalogue ever grows past a
 * page or two this should move to the server.
 */

export type ProjectDetailData = ProjectCardData & {
  slug: string
  logline: string
  ownerName: string | null
  techLeadName: string | null
  startDate: string | null
  budget: number | null
  doneEpisodes: number
  arcs: { id: string; index: number; title: string; plannedEpisodes: number }[]
  recentActivity: { id: string; summary: string; userName: string; createdAt: string }[]
}

export function ProjectsBrowser({
  projects,
  details,
  counts,
  currency,
  fx,
}: {
  projects: ProjectCardData[]
  details: Record<string, ProjectDetailData>
  counts: Record<string, number>
  currency: CurrencyValue
  fx: FxRates
}) {
  const [status, setStatus] = useState<ProjectStatusValue | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ProjectSortValue>('UPDATED')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()

    const filtered = projects.filter((p) => {
      if (status !== 'ALL' && p.status !== status) return false
      if (!term) return true
      return (
        p.title.toLowerCase().includes(term) ||
        p.tags.some((t) => t.toLowerCase().includes(term))
      )
    })

    // Flagship always leads, as in the reference art.
    return [...filtered].sort((a, b) => {
      if (a.isFlagship !== b.isFlagship) return a.isFlagship ? -1 : 1
      switch (sort) {
        case 'TITLE':
          return a.title.localeCompare(b.title, 'zh-Hant')
        case 'PROGRESS':
          return b.progress - a.progress
        default:
          return 0 // server order already satisfies UPDATED / CREATED
      }
    })
  }, [projects, status, search, sort])

  const selected = selectedId ? details[selectedId] : undefined

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6">
      <Breadcrumb />

      <header className="flex flex-wrap items-center gap-3">
        <span className="bg-brand-gradient grid size-10 shrink-0 place-items-center rounded-xl">
          <LayoutGrid aria-hidden className="size-5 text-white" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-lg font-semibold tracking-tight text-ink-50">作品列表</h1>
          <p className="text-xs text-ink-500">
            管理所有短劇作品，追蹤製作進度、預算與發行狀態。
          </p>
        </div>

        {/* 24–29 作品表單 lands in M1; disabled rather than dead (spec v2 §4). */}
        <span
          aria-disabled="true"
          title="新增作品表單尚未實作，預計於 M1 階段交付"
          className="ml-auto inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-lg bg-stage-800 px-4 py-2 text-xs font-medium text-ink-600 ring-1 ring-stage-700"
        >
          <Plus aria-hidden className="size-4" />
          新增作品
          <span className="text-[10px] text-ink-700">M1</span>
        </span>
      </header>

      <StatusPills counts={counts} active={status} onChange={setStatus} />

      <FilterBar
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        layout={layout}
        onLayout={setLayout}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {visible.length === 0 ? (
            <EmptyState
              title={projects.length === 0 ? '還沒有任何作品' : '沒有符合條件的作品'}
              description={
                projects.length === 0
                  ? '執行 npm run db:seed 建立《一灶見山河》，或等新增作品功能於 M1 交付。'
                  : '試試改變狀態篩選或清除搜尋關鍵字。'
              }
            />
          ) : layout === 'grid' ? (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  currency={currency}
                  fx={fx}
                  selected={project.id === selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          ) : (
            <ProjectTable
              projects={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>

        <DetailRail project={selected} currency={currency} fx={fx} />
      </div>
    </div>
  )
}

function Breadcrumb() {
  return (
    <nav aria-label="麵包屑" className="flex items-center gap-1.5 text-[11px] text-ink-500">
      <span className="cursor-default text-ink-600" title="製片中心尚未實作，預計於 M1 階段交付">
        製片中心
      </span>
      <span aria-hidden>/</span>
      <span aria-current="page" className="rounded bg-stage-800 px-2 py-0.5 text-ink-200">
        作品列表
      </span>
    </nav>
  )
}

function StatusPills({
  counts,
  active,
  onChange,
}: {
  counts: Record<string, number>
  active: ProjectStatusValue | 'ALL'
  onChange: (status: ProjectStatusValue | 'ALL') => void
}) {
  const entries: { key: ProjectStatusValue | 'ALL'; label: string }[] = [
    { key: 'ALL', label: '全部' },
    ...PROJECT_STATUSES.map((s) => ({ key: s, label: PROJECT_STATUS_LABEL[s] })),
  ]

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(({ key, label }) => {
        const n = counts[key] ?? 0
        const isActive = key === active
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              isActive
                ? 'bg-brand-gradient glow-accent-sm text-white'
                : 'bg-stage-900 text-ink-400 ring-1 ring-stage-700 hover:bg-stage-800 hover:text-ink-100'
            )}
          >
            {label}
            <span className={cn('text-[10px]', isActive ? 'text-white/80' : 'text-ink-600')}>
              {n}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FilterBar({
  search,
  onSearch,
  sort,
  onSort,
  layout,
  onLayout,
}: {
  search: string
  onSearch: (v: string) => void
  sort: ProjectSortValue
  onSort: (v: ProjectSortValue) => void
  layout: 'grid' | 'list'
  onLayout: (v: 'grid' | 'list') => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        On a phone the search box shares the row with the sort select and the
        view toggle, which squeezes its placeholder to「搜尋作品名稱或」. Give it
        the whole first row below sm and let the controls wrap under it.
      */}
      <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-600"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜尋作品名稱或標籤…"
          aria-label="搜尋作品"
          className="h-9 w-full rounded-lg bg-stage-900 pr-3 pl-9 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 hover:ring-stage-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
      </div>

      <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
        排序
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as ProjectSortValue)}
          aria-label="排序方式"
          className="h-9 rounded-lg bg-stage-900 px-2 pr-7 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 hover:ring-stage-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        >
          {PROJECT_SORTS.map((s) => (
            <option key={s} value={s}>
              {PROJECT_SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex gap-1 rounded-lg bg-stage-900 p-1 ring-1 ring-stage-700">
        {(
          [
            { key: 'grid' as const, label: '格狀檢視', icon: LayoutGrid },
            { key: 'list' as const, label: '列表檢視', icon: List },
          ]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onLayout(key)}
            aria-label={label}
            aria-pressed={layout === key}
            className={cn(
              'grid size-7 place-items-center rounded transition-colors',
              layout === key
                ? 'bg-brand-gradient text-white'
                : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200'
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}

function ProjectTable({
  projects,
  selectedId,
  onSelect,
}: {
  projects: ProjectCardData[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="panel overflow-x-auto rounded-xl bg-stage-900 ring-1 ring-stage-700">
      <table className="w-full min-w-[40rem] text-left">
        <thead className="border-b border-stage-700/60 text-[11px] text-ink-500">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">作品</th>
            <th scope="col" className="px-3 py-2 font-medium">狀態</th>
            <th scope="col" className="px-3 py-2 font-medium">集數</th>
            <th scope="col" className="px-3 py-2 font-medium">進度</th>
            <th scope="col" className="px-3 py-2 font-medium">預計完成</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stage-800">
          {projects.map((p) => (
            <tr
              key={p.id}
              onClick={() => onSelect(p.id)}
              aria-selected={p.id === selectedId}
              className={cn(
                'cursor-pointer text-xs transition-colors',
                p.id === selectedId ? 'bg-accent-600/15' : 'hover:bg-stage-800/60'
              )}
            >
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="art-placeholder size-8 shrink-0 rounded" />
                  <span className="truncate font-medium text-ink-100">{p.title}</span>
                </span>
              </td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
                    PROJECT_STATUS_STYLE[p.status]
                  )}
                >
                  {PROJECT_STATUS_LABEL[p.status]}
                </span>
              </td>
              <td className="px-3 py-2 text-ink-400">
                {p.episodeCount || p.plannedEpisodes}
              </td>
              <td className="px-3 py-2 text-ink-400">{Math.round(p.progress * 100)}%</td>
              <td className="px-3 py-2 text-ink-400">
                {p.dueDate ? new Date(p.dueDate).toLocaleDateString('zh-TW') : '未定'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DetailRail({
  project,
  currency,
  fx,
}: {
  project: ProjectDetailData | undefined
  currency: CurrencyValue
  fx: FxRates
}) {
  if (!project) {
    return (
      <aside className="panel hidden rounded-xl bg-stage-900 ring-1 ring-stage-700 xl:block">
        <p className="px-4 py-8 text-center text-[11px] text-ink-600">
          選擇左側任一作品查看詳情
        </p>
      </aside>
    )
  }

  const pct = Math.round(project.progress * 100)

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    {
      icon: <LayoutGrid aria-hidden className="size-3.5" />,
      label: '類型',
      value: project.tags.length > 0 ? project.tags.join('・') : '未設定',
    },
    {
      icon: <UserRound aria-hidden className="size-3.5" />,
      label: '負責人',
      value: project.ownerName ?? '未指派',
    },
    {
      icon: <Wrench aria-hidden className="size-3.5" />,
      label: '技術支援',
      value: project.techLeadName ?? '未指派',
    },
    {
      icon: <CalendarDays aria-hidden className="size-3.5" />,
      label: '開工日期',
      value: project.startDate
        ? new Date(project.startDate).toLocaleDateString('zh-TW')
        : '未設定',
    },
    {
      icon: <CalendarDays aria-hidden className="size-3.5" />,
      label: '預計完成',
      value: project.dueDate ? new Date(project.dueDate).toLocaleDateString('zh-TW') : '未設定',
    },
    {
      icon: <Coins aria-hidden className="size-3.5" />,
      label: '製作預算',
      value: project.budget !== null ? formatFromBase(project.budget, currency, fx) : '未設定',
    },
    {
      icon: <Coins aria-hidden className="size-3.5" />,
      label: '目前支出',
      value:
        project.spend > 0
          ? formatFromBase(project.spend, currency, fx) +
            (project.budget
              ? `（${Math.round((project.spend / project.budget) * 100)}%）`
              : '')
          : formatFromBase(0, currency, fx),
    },
  ]

  return (
    <aside className="flex flex-col gap-3">
      <section className="panel overflow-hidden rounded-xl bg-stage-900 ring-1 ring-stage-700">
        {/*
          Below xl the rail sits under the grid at full page width, where a
          16:9 cover would be a ~460px slab of empty gradient. Fixed height
          there; the aspect ratio only applies once the rail is a column.
        */}
        <div className="relative h-32 w-full sm:h-40 xl:h-auto xl:aspect-video">
          <div aria-hidden className="art-placeholder absolute inset-0" />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-stage-900 to-transparent"
          />
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink-50">
              {project.title}
            </h2>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
                PROJECT_STATUS_STYLE[project.status]
              )}
            >
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </div>

          <p className="text-[11px] text-ink-500">
            {project.episodeCount > 0
              ? `EP001 – EP${String(project.episodeCount).padStart(3, '0')}（共 ${project.episodeCount} 集）`
              : `規劃中（預計 ${project.plannedEpisodes} 集）`}
          </p>

          <div className="flex items-center gap-2">
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="製作進度"
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800"
            >
              <div
                className={cn('h-full rounded-full', pct > 0 && 'bg-brand-gradient')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-xs font-medium text-ink-100">
              {pct}%
            </span>
          </div>

          <dl className="flex flex-col gap-1.5 border-t border-stage-700/60 pt-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2 text-[11px]">
                <span className="text-ink-600">{row.icon}</span>
                <dt className="w-16 shrink-0 text-ink-500">{row.label}</dt>
                <dd className="min-w-0 flex-1 truncate text-right text-ink-200">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
        <header className="flex items-center border-b border-stage-700/60 px-4 py-2.5">
          <h3 className="text-xs font-semibold text-ink-100">近期動態</h3>
          <span
            aria-disabled="true"
            title="完整動態列表尚未實作，預計於 M4 階段交付"
            className="ml-auto cursor-default text-[10px] text-ink-600"
          >
            查看全部（M4）
          </span>
        </header>
        <div className="p-4">
          {project.recentActivity.length === 0 ? (
            <p className="text-center text-[11px] text-ink-600">尚無動態</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {project.recentActivity.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5">
                  <p className="truncate text-[11px] text-ink-200">{item.summary}</p>
                  <p className="text-[10px] text-ink-600">
                    {item.userName} · {formatRelativeZh(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Link
        href={`/projects/${project.id}`}
        className="bg-brand-gradient glow-accent-sm inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        進入作品總覽
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </aside>
  )
}
