'use client'

import { ChevronLeft, ChevronRight, Package, Pencil, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { EpisodeStatusChip } from '@/components/ui/StatusChip'
import {
  EPISODE_STATUS_LABEL,
  EPISODE_STATUSES,
  type EpisodeStatusValue,
} from '@/lib/constants'
import {
  EPISODE_SORT_LABEL,
  EPISODE_SORTS,
  EPISODE_VIEW_LABEL,
  EPISODE_VIEWS,
  PER_PAGE_OPTIONS,
  type EpisodeListResult,
  type EpisodeRow,
  type EpisodeSegment,
  type EpisodeView,
  type StageColumn,
} from '@/lib/episode-view'
import {
  PRODUCTION_STAGE_ABBR,
  PRODUCTION_STAGE_KEYS,
  PRODUCTION_STAGE_LABEL,
  PRODUCTION_STAGE_STATUS_LABEL,
  toPercent,
  type ProductionStageStatus,
} from '@/lib/production'
import { ArcBar } from '@/components/studio/ArcBar'
import { EpisodeBatchCreate } from '@/components/studio/EpisodeBatchCreate'
import { EpisodeBulkEdit } from '@/components/studio/EpisodeBulkEdit'
import { ProgressView, SegmentView } from '@/components/studio/EpisodeAltViews'
import {
  EpisodeEditDialog,
  type EditableEpisode,
} from '@/components/studio/EpisodeEditDialog'
import type { ArcRow } from '@/lib/arcs-view'
import { cn } from '@/lib/utils'
import { FinalCutPanel } from '@/components/studio/FinalCutPanel'
import { assetPreviewUrl } from '@/lib/asset-url'

/**
 * 集數管理 (design 05).
 *
 * Every piece of state that decides what is on screen — page, page size,
 * search, filters, view, the selected episode — lives in the URL. That is what
 * `docs/ROUTES.md` §4 requires, and it is also what makes the page honest: a
 * reader can send someone a link to "page 9, filtered to 分鏡 unfinished" and
 * they will see the same thing.
 *
 * The server did the paging and filtering. This component renders what it was
 * given and rewrites the query string; it never slices the data itself.
 */

export type EpisodeManagerProps = {
  projectId: string
  result: SerialisedResult
  selected: SerialisedEpisode | null
  view: EpisodeView
  search: string
  status: EpisodeStatusValue | ''
  stage: string
  sort: string
  /**
   * 卷 (Z128). Empty when the caller does not care about grouping — 17 製作
   * 進度 reuses this component and has no business filing episodes.
   */
  arcs?: ArcRow[]
  /** The 卷 currently filtered to, from `?arc=`. */
  arcId?: string
  /** 17 製作進度 reuses this table under its own heading. */
  heading?: string
  /** Whether this member may change the final cut. */
  canWrite?: boolean
  /**
   * 這部作品已經有的集號，給批次建立的預覽用 (Z66).
   *
   * 要全部，不是當前頁的那二十筆——預覽說「會建 120 集」而實際跳過 118 集
   * 的話，那個預覽比沒有更糟。17 製作進度重用這個元件但不建集數，所以可選。
   */
  existingNumbers?: number[]
  /** 批次建立時預填的目標片長，取自作品設定。 */
  defaultTargetSec?: number
  /**
   * 被選中那一集的完整欄位 (Z35/Z36)。
   *
   * 跟列表的 `EpisodeRow` 分開查：`synopsis` 一集可以到五千字，而列表一頁
   * 二十筆、一個字都不顯示它。
   */
  editable?: EditableEpisode | null
  /** 每階段跨全作品的完成度，給「進度總覽」(Z37)。 */
  stageColumns?: StageColumn[]
  /** 每十集一段的彙總，給「分段檢視」(Z37)。 */
  segments?: EpisodeSegment[]
}

/** Dates cross into a Client Component, so they travel as ISO strings. */
export type SerialisedEpisode = Omit<EpisodeRow, 'dueDate' | 'updatedAt'> & {
  dueDate: string | null
  updatedAt: string
}

type SerialisedResult = Omit<EpisodeListResult, 'rows'> & { rows: SerialisedEpisode[] }

export function EpisodeManager({
  projectId,
  result,
  selected,
  view,
  search,
  status,
  stage,
  sort,
  arcs = [],
  arcId = '',
  heading = '集數管理',
  canWrite = false,
  existingNumbers = [],
  defaultTargetSec = 150,
  editable = null,
  stageColumns = [],
  segments = [],
}: EpisodeManagerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [draftSearch, setDraftSearch] = useState(search)

  /*
   * 批次編輯選的是哪幾集 (Z67).
   *
   * 跟 `selected`（詳情列看的那一集）是兩回事，所以叫 picked——同一個字會
   * 讓「選了三集」跟「正在看第七集」在程式裡長得一樣。
   *
   * 不放進網址：它是一個動作的暫時狀態，不是一個看得到的位置。把五十個 id
   * 塞進 query string，換頁還會跟著跑。
   */
  const [picked, setPicked] = useState<Set<string>>(new Set())

  function togglePick(id: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Rewrites the query string.
   *
   * Any change other than paging returns to page 1: staying on page 9 after
   * narrowing the list to three episodes shows an empty table and looks like a
   * bug.
   */
  function go(changes: Record<string, string | number | null>, keepPage = false) {
    const next = new URLSearchParams(params.toString())

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, String(value))
    }
    if (!keepPage && !('page' in changes)) next.delete('page')

    /*
     * 換頁或換篩選就把選取清掉 (Z164).
     *
     * `go()` 是 `router.push` 到同一個路由段，所以這個元件不會 unmount，
     * `picked` 整組留著。而批次列只印「選了 5 集」、不印是哪幾集——於是
     * 「篩 DRAFT 選三集 → 改篩 RELEASED → 按套用」會改到畫面上一集都看不到
     * 的那三集，而批次修改**沒有預覽也沒有復原**。
     *
     * 只有「選哪一集看詳情」（`keepPage`）不清：那不會換掉畫面上的清單。
     */
    if (!keepPage) setPicked(new Set())

    router.push(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const { rows, matched, page, perPage, pageCount, stats } = result

  return (
    <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-ink-100">
          {heading}
          <span className="ml-1.5 text-[11px] font-normal text-ink-500">
            （共 {stats.total} 集）
          </span>
        </h2>

        <div className="flex gap-1 rounded-lg bg-stage-900 p-0.5 ring-1 ring-stage-700">
          {EPISODE_VIEWS.map((option) => {
            const isCurrent = option === view
            // 四種都做出來了 (Z37)：PROGRESS 與 SEGMENT 本來是灰的、掛著 M1。
            return (
              <button
                key={option}
                type="button"
                onClick={() => go({ view: option === 'LIST' ? null : option })}
                aria-pressed={isCurrent}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                  isCurrent
                    ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                    : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
                )}
              >
                {EPISODE_VIEW_LABEL[option]}
              </button>
            )
          })}
        </div>

        <span className="ml-auto text-[11px] text-ink-500">
          顯示：第 {page} / {pageCount} 頁
          {matched !== stats.total && `（篩選後 ${matched} 集）`}
        </span>
      </header>

      {/* 批次編輯 (Z67)。選了才出現——沒選的時候它只是一條佔位的灰條。 */}
      {canWrite && picked.size > 0 && (
        <EpisodeBulkEdit
          projectId={projectId}
          selected={[...picked]}
          onClear={() => setPicked(new Set())}
        />
      )}

      <StatsBar stats={stats} />

      {arcs.length > 0 && (
        <ArcBar
          projectId={projectId}
          arcs={arcs}
          activeArcId={arcId}
          canWrite={canWrite}
          onFilter={(id) => go({ arc: id })}
          selectable={rows.map((row) => ({
            id: row.id,
            number: row.number,
            title: row.title,
          }))}
        />
      )}

      {/* --- filters ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            go({ q: draftSearch.trim() || null })
          }}
          className="relative w-full min-w-0 sm:w-72"
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-600"
          />
          <input
            type="search"
            name="q"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="搜尋集數標題、劇情關鍵字…"
            aria-label="搜尋集數"
            className="h-9 w-full rounded-lg bg-stage-900 pr-3 pl-9 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 hover:ring-stage-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </form>

        <Select
          label="製作狀態"
          value={status}
          onChange={(value) => go({ status: value || null })}
          options={[
            { value: '', label: '全部' },
            ...EPISODE_STATUSES.map((s) => ({ value: s, label: EPISODE_STATUS_LABEL[s] })),
          ]}
        />

        <Select
          label="未完成階段"
          value={stage}
          onChange={(value) => go({ stage: value || null })}
          options={[
            { value: '', label: '全部' },
            ...PRODUCTION_STAGE_KEYS.map((key) => ({
              value: key,
              label: PRODUCTION_STAGE_LABEL[key],
            })),
          ]}
        />

        <Select
          label="排序"
          value={sort}
          onChange={(value) => go({ sort: value === 'NUMBER_ASC' ? null : value })}
          options={EPISODE_SORTS.map((s) => ({ value: s, label: EPISODE_SORT_LABEL[s] }))}
        />

        {/*
          這裡本來是兩顆標著 M1 的佔位鈕：「批次操作」與「新增集數」——正好
          是 Z67 與 Z66 (Z66/Z67)。做出來之後佔位要拿掉，不然畫面上同時有一
          顆能按的和一顆灰的，而灰的那顆還掛著一個已經過去的里程碑。

          「批次操作」不需要自己的按鈕：勾選集數之後上面那條批次列就會出現，
          而一顆「請先勾選」的按鈕只是多一次點擊換一句廢話。
        */}
        {canWrite && arcs.length > 0 && (
          <EpisodeBatchCreate
            projectId={projectId}
            arcs={arcs.map((arc) => ({ id: arc.id, title: arc.title }))}
            defaultTargetSec={defaultTargetSec}
            existingNumbers={existingNumbers}
          />
        )}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="panel min-w-0 overflow-hidden rounded-xl bg-stage-900 ring-1 ring-stage-700">
          {rows.length === 0 ? (
            <EmptyState
              title={matched === 0 && stats.total > 0 ? '沒有符合條件的集數' : '尚未建立集數'}
              description={
                matched === 0 && stats.total > 0
                  ? '調整搜尋或篩選條件後再試一次。'
                  : '建立集數後，這裡會列出每一集的九階段進度。'
              }
              className="py-14"
            />
          ) : view === 'PROGRESS' ? (
            <ProgressView
              rows={rows}
              columns={stageColumns}
              selectedId={selected?.id ?? null}
              onPick={(id) => go({ ep: id }, true)}
            />
          ) : view === 'SEGMENT' ? (
            <SegmentView
              segments={segments}
              perPage={perPage}
              onGoToPage={(target) => go({ page: target, view: null })}
            />
          ) : view === 'CARD' ? (
            <CardView
              rows={rows}
              projectId={projectId}
              selectedId={selected?.id ?? null}
              go={go}
              picked={canWrite ? picked : null}
              onPick={togglePick}
            />
          ) : (
            <ListView
              rows={rows}
              selectedId={selected?.id ?? null}
              go={go}
              /* 沒有寫入權限就不給多選——批次編輯的每一顆按鈕都會被擋下來。 */
              picked={canWrite ? picked : null}
              onPick={togglePick}
            />
          )}

          {/*
            分段檢視不分頁：它一次就是全部十二段，下面再放一個「第 1 / 12
            頁」只會讓人以為段也分頁了。
          */}
          {rows.length > 0 && view !== 'SEGMENT' && (
            <Pagination
              page={page}
              pageCount={pageCount}
              perPage={perPage}
              matched={matched}
              go={go}
            />
          )}
        </div>

        <DetailRail
          episode={selected}
          editable={editable}
          arcs={arcs}
          projectId={projectId}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function StatsBar({ stats }: { stats: EpisodeListResult['stats'] }) {
  const pctOf = (n: number) => (stats.total > 0 ? `${((n / stats.total) * 100).toFixed(1)}%` : '—')

  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-stage-900 px-4 py-3 ring-1 ring-stage-700">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] text-ink-500">全部集數</span>
        <span className="text-xl font-semibold text-ink-50 tabular-nums">{stats.total}</span>
      </div>

      {[
        { label: '已完成', value: stats.done, dot: 'text-emerald-400' },
        { label: '進行中', value: stats.inProgress, dot: 'text-accent-400' },
        { label: '待處理', value: stats.pending, dot: 'text-ink-600' },
      ].map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5 text-[11px]">
          <span aria-hidden className={cn('text-[8px]', item.dot)}>
            ●
          </span>
          <span className="text-ink-500">{item.label}</span>
          <span className="text-ink-200 tabular-nums">{item.value}</span>
          <span className="text-ink-600 tabular-nums">({pctOf(item.value)})</span>
        </div>
      ))}

      <div className="flex min-w-[12rem] flex-1 items-center gap-2">
        <span className="shrink-0 text-[11px] text-ink-500">九大階段整體進度</span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
          <div
            className="bg-brand-gradient h-full rounded-full"
            style={{ width: `${toPercent(stats.overallProgress)}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] font-medium text-ink-200 tabular-nums">
          {toPercent(stats.overallProgress)}%
        </span>
      </div>
    </div>
  )
}

type Go = (changes: Record<string, string | number | null>, keepPage?: boolean) => void

function ListView({
  rows,
  selectedId,
  go,
  picked,
  onPick,
}: {
  rows: SerialisedEpisode[]
  selectedId: string | null
  go: Go
  /** 批次編輯選取的集數；null 代表這個畫面不開放多選 (Z67)。 */
  picked: Set<string> | null
  onPick: (id: string) => void
}) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] text-ink-600">
            <tr className="border-b border-stage-700/60">
              {picked && (
                <th scope="col" className="w-8 pl-4">
                  <span className="sr-only">選取</span>
                </th>
              )}
              <th scope="col" className="w-20 px-4 py-2 font-medium">
                集數
              </th>
              <th scope="col" className="w-40 px-2 py-2 font-medium">
                集數標題
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                劇情重點 / 備註
              </th>
              <th scope="col" className="w-20 px-2 py-2 font-medium">
                製作狀態
              </th>
              <th scope="col" className="w-44 px-2 py-2 font-medium">
                九大階段進度
              </th>
              <th scope="col" className="w-16 px-2 py-2 text-right font-medium">
                完成率
              </th>
              <th scope="col" className="w-24 px-4 py-2 text-right font-medium">
                更新時間
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => go({ ep: row.id }, true)}
                className={cn(
                  'cursor-pointer border-b border-stage-800/70 transition-colors last:border-0',
                  row.id === selectedId ? 'bg-accent-600/10' : 'hover:bg-stage-850/60'
                )}
              >
                {picked && (
                  /*
                   * `stopPropagation`：這一列整列可以點（進詳情），而勾選不
                   * 該順便換頁——少了它，每勾一集就跳走一次。
                   */
                  <td className="pl-4" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={picked.has(row.id)}
                      onChange={() => onPick(row.id)}
                      aria-label={`選取第 ${row.number} 集`}
                      className="size-3.5 accent-accent-500"
                    />
                  </td>
                )}
                <td className="px-4 py-2 font-medium text-ink-300 tabular-nums">
                  EP{String(row.number).padStart(3, '0')}
                </td>
                <td className="px-2 py-2">
                  <span className="block truncate text-ink-200">
                    {row.title || <span className="text-ink-600">未命名</span>}
                  </span>
                </td>
                <td className="max-w-0 px-2 py-2">
                  <span className="block truncate text-ink-500">
                    {row.logline || <span className="text-ink-700">—</span>}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <EpisodeStatusChip status={row.status} />
                </td>
                <td className="px-2 py-2">
                  <StageStrip stages={row.stages} />
                </td>
                <td className="px-2 py-2 text-right text-ink-200 tabular-nums">
                  {toPercent(row.progress)}%
                </td>
                <td className="px-4 py-2 text-right text-ink-500 tabular-nums">
                  {formatDate(row.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Below lg the seven columns become seven slivers; stack instead. */}
      <ul className="flex flex-col lg:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center border-b border-stage-800/70">
            {/*
              核取方塊放在按鈕**外面**：`<button>` 裡面不能再放可互動元素，
              放進去在鍵盤與螢幕閱讀器上都是壞的。
            */}
            {picked && (
              <label className="flex shrink-0 items-center pl-4">
                <span className="sr-only">選取第 {row.number} 集</span>
                <input
                  type="checkbox"
                  checked={picked.has(row.id)}
                  onChange={() => onPick(row.id)}
                  className="size-3.5 accent-accent-500"
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => go({ ep: row.id }, true)}
              className={cn(
                'flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors',
                row.id === selectedId ? 'bg-accent-600/10' : 'hover:bg-stage-850/60'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-ink-300 tabular-nums">
                  EP{String(row.number).padStart(3, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                  {row.title || <span className="text-ink-600">未命名</span>}
                </span>
                <EpisodeStatusChip status={row.status} />
              </div>
              <StageStrip stages={row.stages} />
              <div className="flex items-center justify-between text-[10px] text-ink-600">
                <span className="truncate">{row.logline || '—'}</span>
                <span className="shrink-0 tabular-nums">{toPercent(row.progress)}%</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function CardView({
  rows,
  selectedId,
  go,
  picked,
  onPick,
}: {
  rows: SerialisedEpisode[]
  projectId: string
  selectedId: string | null
  go: Go
  picked: Set<string> | null
  onPick: (id: string) => void
}) {
  return (
    <ul className="grid gap-2 p-3 sm:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row) => (
        <li key={row.id} className="relative">
          {/*
            疊在卡片角落，但在 `<button>` **外面**——按鈕裡面不能再放可互動
            元素。`z-10` 讓它壓在卡片上方，不然整張卡片的點擊會蓋掉它。
          */}
          {picked && (
            <label className="absolute top-2 left-2 z-10 flex rounded bg-stage-950/70 p-1 ring-1 ring-stage-700">
              <span className="sr-only">選取第 {row.number} 集</span>
              <input
                type="checkbox"
                checked={picked.has(row.id)}
                onChange={() => onPick(row.id)}
                className="size-3.5 accent-accent-500"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => go({ ep: row.id }, true)}
            className={cn(
              'panel flex w-full flex-col overflow-hidden rounded-lg bg-stage-850 text-left ring-1 transition-all',
              row.id === selectedId ? 'ring-accent-500/60' : 'ring-stage-700 hover:ring-stage-600'
            )}
          >
            <div className="relative aspect-video w-full">
              {row.coverAssetId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetPreviewUrl(row.coverAssetId)}
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
                EP{String(row.number).padStart(3, '0')}
              </span>
              <span className="absolute right-1.5 bottom-1.5">
                <EpisodeStatusChip status={row.status} />
              </span>
            </div>

            <div className="flex flex-col gap-1.5 p-2.5">
              <span className="truncate text-xs text-ink-200">
                {row.title || <span className="text-ink-600">未命名</span>}
              </span>
              <StageStrip stages={row.stages} />
              <span className="text-right text-[10px] text-ink-500 tabular-nums">
                {toPercent(row.progress)}%
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Nine cells, one per stage, in pipeline order. */
function StageStrip({ stages }: { stages: SerialisedEpisode['stages'] }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label="九大階段進度">
      {stages.map((cell) => (
        <span
          key={cell.key}
          title={`${PRODUCTION_STAGE_LABEL[cell.key]}：${PRODUCTION_STAGE_STATUS_LABEL[cell.status]}${
            cell.status === 'in_progress' ? ` ${cell.progressPercent}%` : ''
          }`}
          className={cn('h-4 w-4 shrink-0 rounded-sm ring-1 ring-inset', cellClass(cell.status))}
        />
      ))}
    </div>
  )
}

function cellClass(status: ProductionStageStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500 ring-emerald-400/50'
    case 'in_progress':
      return 'bg-accent-500 ring-accent-400/50'
    case 'in_review':
      return 'bg-sky-500 ring-sky-400/50'
    case 'blocked':
      return 'bg-rose-500 ring-rose-400/50'
    default:
      return 'bg-stage-800 ring-stage-700'
  }
}

function Pagination({
  page,
  pageCount,
  perPage,
  matched,
  go,
}: {
  page: number
  pageCount: number
  perPage: number
  matched: number
  go: Go
}) {
  // A window around the current page, so 12 pages do not become 120 buttons.
  const windowSize = 5
  const start = Math.max(1, Math.min(page - Math.floor(windowSize / 2), pageCount - windowSize + 1))
  const pages = Array.from({ length: Math.min(windowSize, pageCount) }, (_, i) => start + i)

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-stage-700/60 px-4 py-3">
      <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
        顯示
        <select
          value={perPage}
          onChange={(event) => go({ per: event.target.value })}
          aria-label="每頁筆數"
          className="h-7 rounded-md bg-stage-850 px-1.5 pr-6 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        筆 / 頁
      </label>

      <span className="text-[11px] text-ink-500">共 {matched} 集</span>

      <div className="ml-auto flex items-center gap-1">
        <PageButton disabled={page <= 1} onClick={() => go({ page: page - 1 }, true)} label="上一頁">
          <ChevronLeft aria-hidden className="size-3.5" />
        </PageButton>

        {start > 1 && <span className="px-1 text-[11px] text-ink-700">…</span>}

        {pages.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => go({ page: n }, true)}
            aria-current={n === page ? 'page' : undefined}
            className={cn(
              'h-7 min-w-7 rounded-md px-2 text-[11px] tabular-nums transition-colors',
              n === page
                ? 'bg-brand-gradient text-white'
                : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
            )}
          >
            {n}
          </button>
        ))}

        {start + pages.length - 1 < pageCount && (
          <>
            <span className="px-1 text-[11px] text-ink-700">…</span>
            <button
              type="button"
              onClick={() => go({ page: pageCount }, true)}
              className="h-7 min-w-7 rounded-md px-2 text-[11px] text-ink-400 tabular-nums hover:bg-stage-800 hover:text-ink-100"
            >
              {pageCount}
            </button>
          </>
        )}

        <PageButton
          disabled={page >= pageCount}
          onClick={() => go({ page: page + 1 }, true)}
          label="下一頁"
        >
          <ChevronRight aria-hidden className="size-3.5" />
        </PageButton>
      </div>
    </div>
  )
}

function PageButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={cn(
        'grid size-7 place-items-center rounded-md transition-colors',
        disabled
          ? 'cursor-default text-ink-700'
          : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {children}
    </button>
  )
}

function DetailRail({
  episode,
  editable,
  arcs,
  projectId,
  canWrite,
}: {
  episode: SerialisedEpisode | null
  /** 選中那一集的完整欄位；只有它需要（synopsis 一集可以到五千字）。 */
  editable: EditableEpisode | null
  arcs: ArcRow[]
  projectId: string
  canWrite: boolean
}) {
  const [editing, setEditing] = useState(false)

  if (!episode) {
    return (
      <aside className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
        <EmptyState
          title="選擇一集以檢視詳情"
          description="點任一列就會在這裡顯示劇情簡述與九大階段狀態。"
          className="py-12"
        />
      </aside>
    )
  }

  const doneCount = episode.stages.filter((s) => s.status === 'completed').length

  return (
    <aside className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <div className="flex items-center gap-2">
        <span className="rounded bg-stage-800 px-1.5 py-0.5 text-[11px] font-medium text-ink-200 ring-1 ring-inset ring-stage-700 tabular-nums">
          EP{String(episode.number).padStart(3, '0')}
        </span>
        <EpisodeStatusChip status={episode.status} />

        {/*
          這支鉛筆以前是個禁用的 `<span>`，標題寫著「尚未實作，預計於 M1 階段
          交付」——而 M1 是很久以前的事 (Z35)。
        */}
        {canWrite && editable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`編輯第 ${episode.number} 集`}
            title="編輯這一集"
            className="tap ml-auto rounded p-1 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            <Pencil aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      {editing && editable && (
        <EpisodeEditDialog
          projectId={projectId}
          episode={editable}
          arcs={arcs.map((arc) => ({ id: arc.id, title: arc.title }))}
          onClose={() => setEditing(false)}
        />
      )}

      <h3 className="truncate text-sm font-semibold text-ink-50">
        {episode.title || <span className="text-ink-600">未命名</span>}
      </h3>

      <div className="relative aspect-video w-full overflow-hidden rounded-lg">
        {episode.coverAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetPreviewUrl(episode.coverAssetId)}
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div aria-hidden className="art-placeholder absolute inset-0" />
        )}
      </div>

      {/*
        詳情要把「這一集是什麼」講完 (Z36)。
        本來只有一句 logline——而大綱、目標片長、期限這三樣都是每天會看的。
      */}
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[10px] text-ink-600">
        <div className="flex gap-1">
          <dt>目標片長</dt>
          <dd className="text-ink-300 tabular-nums">
            {editable ? `${editable.targetSec} 秒` : '—'}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>期限</dt>
          <dd className={cn(episode.dueDate ? 'text-ink-300' : 'text-ink-700')}>
            {episode.dueDate ? formatDate(episode.dueDate) : '沒有設定'}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1">
        <h4 className="text-[11px] font-medium text-ink-400">劇情重點</h4>
        <p className="text-xs leading-relaxed text-ink-300">
          {episode.logline || <span className="text-ink-600">尚未撰寫。</span>}
        </p>
      </div>

      {editable?.synopsis && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[11px] font-medium text-ink-400">分集大綱</h4>
          <p className="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-ink-300">
            {editable.synopsis}
          </p>
        </div>
      )}

      {editable?.notes && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[11px] font-medium text-ink-400">備註</h4>
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink-500">
            {editable.notes}
          </p>
        </div>
      )}

      {/* 設計稿 05 的「進入集數詳情 →」(Z36)。側欄放得下「是什麼」，放不下
          九大階段的手動控制與每一段內容的入口。 */}
      <Link
        href={`/projects/${projectId}/episodes/${episode.id}`}
        className="tap inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-accent-500"
      >
        進入集數詳情
        <ChevronRight aria-hidden className="size-3.5" />
      </Link>

      <FinalCutPanel projectId={projectId} episodeId={episode.id} canWrite={canWrite} />

      <Link
        href={`/projects/${projectId}/episodes/${episode.id}/assets`}
        className="flex items-center gap-1.5 rounded-lg bg-stage-850 px-3 py-2 text-[11px] text-ink-300 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50 hover:ring-stage-600"
      >
        <Package aria-hidden className="size-3.5 text-accent-400" />
        本集素材
        <ChevronRight aria-hidden className="ml-auto size-3 text-ink-600" />
      </Link>

      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-medium text-ink-400">
          製作階段
          <span className="ml-1 text-ink-600">
            （{episode.stages.length} 階段・{doneCount} 已完成）
          </span>
        </h4>

        <ul className="grid grid-cols-9 gap-1">
          {episode.stages.map((cell) => (
            <li key={cell.key} className="flex flex-col items-center gap-1">
              <span
                title={`${PRODUCTION_STAGE_LABEL[cell.key]}：${PRODUCTION_STAGE_STATUS_LABEL[cell.status]}`}
                className={cn(
                  'size-4 rounded-full ring-1 ring-inset',
                  cellClass(cell.status)
                )}
              />
              <span className="text-[8px] whitespace-nowrap text-ink-600">
                {PRODUCTION_STAGE_ABBR[cell.key]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
          <div
            className="bg-brand-gradient h-full rounded-full"
            style={{ width: `${toPercent(episode.progress)}%` }}
          />
        </div>
        <span className="text-[11px] text-ink-200 tabular-nums">{toPercent(episode.progress)}%</span>
      </div>

      <Link
        href={`/projects/${projectId}`}
        className="text-center text-[11px] text-ink-600 transition-colors hover:text-ink-300"
      >
        返回作品總覽
      </Link>
    </aside>
  )
}

/* -------------------------------------------------------------------------- */

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-9 rounded-lg bg-stage-900 px-2 pr-7 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 hover:ring-stage-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Fixed locale and timezone so the server and the browser agree. */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei',
  }).format(new Date(value))
}
