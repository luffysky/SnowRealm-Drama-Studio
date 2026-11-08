import {
  Activity,
  AlertTriangle,
  BookOpen,
  Clapperboard,
  Coins,
  Film,
  Layers,
  ListChecks,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { getSessionUser } from '@/lib/auth/session'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE } from '@/lib/constants'
import {
  DASHBOARD_RANGES,
  getDashboard,
  readRange,
  type DashboardData,
  type DashboardRange,
} from '@/lib/dashboard'
import { PulseChart } from '@/components/studio/PulseChart'
import { formatBytes } from '@/lib/utils'
import { ASSET_KIND_LABEL } from '@/lib/constants'
import {
  PRODUCTION_STAGE_LABEL,
  stageOrdinal,
  STAGES_PER_EPISODE,
  toPercent,
} from '@/lib/production'
import { cn, formatRelativeZh } from '@/lib/utils'
import { AltTitles } from '@/components/studio/AltTitles'
import { assetPreviewUrl } from '@/lib/asset-url'
import { LiveData } from '@/components/studio/LiveData'

export const metadata: Metadata = { title: '工作室儀表板' }

/**
 * 01 全域工作室儀表板 (design 01 v2).
 *
 * Cross-project only: no single-project editor is reachable from here
 * (spec v3 §11.3). Every figure is read from the database — with an empty
 * studio this page legitimately shows zeros and empty states, and that is the
 * correct output rather than a reason to seed something.
 */
type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** First value only: `?d=7&d=90` must not become "7,90". */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

export default async function DashboardPage({ searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  /*
   * 篩選走網址，不走 `useState` (Z191).
   *
   * 三個理由：這一頁其餘部分是在伺服器端算完才送出來的，篩選若在用戶端就得
   * 把整份資料先送到瀏覽器再丟掉大半；網址可以貼給對方而對方看到同一個畫面；
   * 而且 `<LiveData>` 的輪詢（`router.refresh()`）會原地帶著目前的篩選重算，
   * 不會把人彈回預設值。
   */
  const sp = await searchParams
  const days = readRange(one(sp.d))
  const data = await getDashboard(user.id, { projectId: one(sp.p) || null, days })

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
      {/*
        儀表板常常是開著不動的那一頁，所以除了切回分頁之外也慢慢輪詢。
      */}
      <LiveData intervalSec={60} />
      <GreetingHero name={user.name} data={data} />
      <Controls data={data} />
      <KpiRow data={data} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ProjectsPanel data={data} />
        <PulsePanel data={data} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <StagePanel data={data} />
        <LibraryPanel data={data} />
        <AssetPanel data={data} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
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

/**
 * 期間與作品的切換鍵 (Z191).
 *
 * 做成 `<Link>` 而不是 `<select>`：它們是伺服器端元件，沒有一行用戶端 JS，
 * 可以中鍵開新分頁，而且網址本身就是狀態——貼給對方，對方看到同一個畫面。
 */
function Controls({ data }: { data: DashboardData }) {
  const { days, projectId } = data.scope

  /** 換一個維度時保留另一個維度，不然切期間會把作品篩選洗掉。 */
  const href = (patch: { p?: string | null; d?: DashboardRange }) => {
    const params = new URLSearchParams()
    const nextProject = patch.p === undefined ? projectId : patch.p
    const nextDays = patch.d ?? days
    if (nextProject) params.set('p', nextProject)
    if (nextDays !== 30) params.set('d', String(nextDays))
    const query = params.toString()
    return query ? `/dashboard?${query}` : '/dashboard'
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Chips label="期間">
        {DASHBOARD_RANGES.map((range) => (
          <Chip key={range} href={href({ d: range })} active={range === days}>
            近 {range} 天
          </Chip>
        ))}
      </Chips>

      {data.projects.length > 1 && (
        <Chips label="作品">
          <Chip href={href({ p: null })} active={projectId === null}>
            全部
          </Chip>
          {data.projects.map((project) => (
            <Chip key={project.id} href={href({ p: project.id })} active={project.id === projectId}>
              {project.title}
            </Chip>
          ))}
        </Chips>
      )}
    </div>
  )
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-[10px] text-ink-600">{label}</span>
      {children}
    </div>
  )
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      // 目前選的那一個要能被讀螢幕報出來，不是只有顏色不一樣。
      aria-current={active ? 'true' : undefined}
      className={cn(
        'max-w-[14rem] truncate rounded-full px-2.5 py-1 text-[11px] ring-1 ring-inset transition-colors',
        active
          ? 'bg-accent-500/15 text-accent-200 ring-accent-500/50'
          : 'bg-stage-850 text-ink-400 ring-stage-700 hover:text-ink-200'
      )}
    >
      {children}
    </Link>
  )
}

/* -------------------------------------------------------------------------- */

function KpiRow({ data }: { data: DashboardData }) {
  const totals = data.stageTotals
  const days = data.scope.days
  const pctOf = (n: number) =>
    data.stageRecords > 0 ? `${((n / data.stageRecords) * 100).toFixed(1)}%` : '—'

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <Tile icon={<TrendingUp className="size-4" />} label={`近 ${days} 天動態`}>
        <p className="text-2xl font-semibold text-ink-50">
          {data.pulseTotal.toLocaleString('en-US')}
          <span className="ml-1 text-sm font-normal text-ink-500">筆</span>
        </p>
        <p className="mt-1 text-[11px] text-ink-600">
          {data.pulseTotal === 0 ? '這段期間沒有動過' : '建立、修改、上傳與 AI 套用'}
        </p>
      </Tile>

      <Tile icon={<Sparkles className="size-4" />} label={`AI 任務（近 ${days} 天）`} href="/ai">
        <p className="text-2xl font-semibold text-ink-50">
          {data.ai.total.toLocaleString('en-US')}
          <span className="ml-1 text-sm font-normal text-ink-500">個</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink-600">
          {data.ai.awaitingReview > 0 && (
            <span className="text-gilt-300">{data.ai.awaitingReview} 個等你審</span>
          )}
          {data.ai.failed > 0 && <span className="text-rose-300">{data.ai.failed} 個失敗</span>}
          {data.ai.total === 0 ? (
            <span>這段期間沒有跑過</span>
          ) : (
            <span>
              成功 {data.ai.succeeded}・取消 {data.ai.cancelled}
            </span>
          )}
        </p>
      </Tile>

      <Tile icon={<Coins className="size-4" />} label={`近 ${days} 天花費`} href="/costs">
        {data.spend.length === 0 ? (
          <>
            <p className="text-2xl font-semibold text-ink-50">
              0<span className="ml-1 text-sm font-normal text-ink-500">筆</span>
            </p>
            <p className="mt-1 text-[11px] text-ink-600">這段期間沒有記到帳</p>
          </>
        ) : (
          <>
            {/*
              各幣別分開列，**不換算**成同一個幣別再加起來——匯率是當天的，而
              這一格沒有地方放「用的是哪一天的匯率」。
            */}
            <ul className="flex flex-col gap-0.5">
              {data.spend.map((row) => (
                <li key={row.currency} className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold text-ink-50 tabular-nums">
                    {row.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </span>
                  <span className="text-xs text-ink-500">{row.currency}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-600">
              {data.spend.reduce((n, row) => n + row.count, 0)} 筆帳
            </p>
          </>
        )}
      </Tile>
    </div>
  )
}

function Tile({
  icon,
  label,
  href,
  children,
}: {
  icon: ReactNode
  label: string
  /** 有的話整格可以點進去看細節；沒有的話它就是一塊會呆著的板子。 */
  href?: string
  children: ReactNode
}) {
  const body = (
    <>
      <h2 className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
        <span aria-hidden className="text-accent-400">
          {icon}
        </span>
        {label}
      </h2>
      {children}
    </>
  )

  const className =
    'panel flex flex-col rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700 transition-all'

  if (href) {
    return (
      <Link href={href} className={cn(className, 'hover:ring-stage-600')}>
        {body}
      </Link>
    )
  }
  return <section className={className}>{body}</section>
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
 * 動態脈搏（Z191），取代原本那張「製作進度趨勢」。
 *
 * 舊的那張讀 `production_progress_events`——而那張表在正式庫裡是**零筆**，所以
 * 它從上線到現在畫的一直是空狀態。它的註解說得沒錯（不從現況回推就是對的），
 * 只是那個「等第一次階段異動」等不到：階段是在那張表加進來之前就設好的。
 *
 * 這張讀 `activities`，六百多筆帶時間的真紀錄。一樣是量到的歷史，沒有回推。
 * 階段異動還是會畫——它變成下面那一行附註，有才出現。
 */
function PulsePanel({ data }: { data: DashboardData }) {
  const days = data.scope.days
  const stageMoves = data.trend.reduce((n, point) => n + point.completed + point.started, 0)

  return (
    <Panel title={`動態脈搏（近 ${days} 天）`} icon={<TrendingUp className="size-3.5" />}>
      {data.pulseTotal === 0 ? (
        <EmptyState
          title="這段期間沒有任何動態"
          description={
            days === 90
              ? '這個作品近三個月沒有被改過。'
              : '換成更長的期間看看，或是去作品裡動一下——建立、修改、上傳與 AI 套用都會記在這裡。'
          }
          icon={<TrendingUp aria-hidden className="size-5 text-ink-500" />}
          className="py-10"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <PulseChart points={data.pulse} days={days} />
          <p className="text-[10px] leading-relaxed text-ink-600">
            {stageMoves > 0
              ? `同一期間有 ${stageMoves} 次製作階段異動。`
              : '這段期間沒有製作階段異動——九大階段的進度是在別的時候設的。'}
          </p>
        </div>
      )}
    </Panel>
  )
}

/**
 * 內容存量。
 *
 * 進度條說的是「做完幾成」，這一塊說的是「現在手上有多少東西」——兩個都要，因為
 * 一個 0% 的作品可能已經寫了十五萬字，也可能一個字都沒有，而進度條分不出來。
 */
function LibraryPanel({ data }: { data: DashboardData }) {
  const p = data.scope.projectId

  /*
   * 路徑在原地寫全，不走 `to('/novel')` 那種小幫手 (Z194).
   *
   * 第一版就是那樣寫的，而它把劇本連到 `/projects/<id>/script`——磁碟上是
   * `scripts`，複數，點下去 404。`check:links` 當時是綠的，因為它看不到
   * 「路徑字面值包在函式呼叫裡、再透過 `href={row.href}` 展開」這個形狀。
   *
   * 工具那邊補上這個形狀了，但它只讀得到字面值裡**寫出來**的那一段——小幫手
   * 補上去的前綴它看不見。所以每一條自己寫全。
   */
  const rows = [
    {
      label: '小說',
      value: `${data.library.chapters} 章`,
      note:
        data.library.chapterChars > 0
          ? `${data.library.chapterChars.toLocaleString('en-US')} 字`
          : '還沒有內容',
      href: p ? `/projects/${p}/novel` : '/projects',
    },
    {
      label: '劇本',
      value: `${data.library.scenes} 場`,
      note: data.library.scenes === 0 ? '還沒有場次' : '已切好場次',
      href: p ? `/projects/${p}/scripts` : '/projects',
    },
    {
      label: '分鏡',
      value: `${data.library.shots} 鏡`,
      note: data.library.shots === 0 ? '還沒有鏡頭' : '已排好鏡頭',
      href: p ? `/projects/${p}/storyboard` : '/projects',
    },
    {
      label: '角色',
      value: `${data.library.characters} 位`,
      note: data.library.characters === 0 ? '還沒有角色' : '已建檔',
      href: p ? `/projects/${p}/characters` : '/projects',
    },
    {
      label: '世界觀',
      value: `${data.library.worldEntries} 條`,
      note: data.library.worldEntries === 0 ? '還沒有條目' : '已建檔',
      href: p ? `/projects/${p}/world` : '/projects',
    },
  ]

  return (
    <Panel title="內容存量" icon={<BookOpen className="size-3.5" />}>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label}>
            <Link
              href={row.href}
              className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-stage-850"
            >
              <span className="w-12 shrink-0 text-[11px] text-ink-400">{row.label}</span>
              <span className="shrink-0 text-sm text-ink-100 tabular-nums">{row.value}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[10px] text-ink-600">
                {row.note}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * 素材。
 *
 * 口徑跟素材中心一樣（只算 `LIBRARY`），不然兩頁各說一個數字，而兩個都「是對
 * 的」——那種不一致最難查。
 */
function AssetPanel({ data }: { data: DashboardData }) {
  const totalBytes = data.assets.reduce((n, row) => n + row.bytes, 0)
  const totalCount = data.assets.reduce((n, row) => n + row.count, 0)
  const max = Math.max(1, ...data.assets.map((row) => row.bytes))

  return (
    <Panel
      title="素材"
      icon={<Package className="size-3.5" />}
      action={
        <span className="shrink-0 text-[11px] text-ink-500 tabular-nums">
          {totalCount} 件・{formatBytes(totalBytes)}
        </span>
      }
    >
      {data.assets.length === 0 ? (
        <EmptyState
          title="還沒有素材"
          description="上傳的圖片、配音與音樂會依類型統計在這裡。"
          icon={<Package aria-hidden className="size-5 text-ink-500" />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.assets.map((row) => (
            <li key={row.kind} className="flex items-center gap-2">
              <span className="w-12 shrink-0 truncate text-[11px] text-ink-400">
                {ASSET_KIND_LABEL[row.kind as keyof typeof ASSET_KIND_LABEL] ?? row.kind}
              </span>
              <span className="w-10 shrink-0 text-right text-[10px] text-ink-600 tabular-nums">
                {row.count} 件
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
                <div
                  className="bg-brand-gradient h-full rounded-full"
                  style={{ width: `${(row.bytes / max) * 100}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] text-ink-300 tabular-nums">
                {formatBytes(row.bytes)}
              </span>
            </li>
          ))}
        </ul>
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
