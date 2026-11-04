import { BookOpen, FileText, PenLine } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { NovelExportMenu } from '@/components/studio/NovelExportMenu'
import { OutlineBoard } from '@/components/studio/OutlineBoard'
import { EmptyState } from '@/components/ui/StateViews'
import { adapterForTask } from '@/lib/ai/jobs'
import { getSessionUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listOutline } from '@/lib/episodes'
import { requireProjectPage } from '@/lib/project-access'
import { novelTitleOf } from '@/lib/project-titles'
import type { ProjectReadiness } from '@/lib/ai/readiness'
import { getFxRates } from '@/lib/settings'
import { novelIndex } from '@/lib/writing'

export const metadata: Metadata = { title: '小說編輯' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 小說工作台 — the project-level novel surface.
 *
 * What was here before listed all 120 episodes as identical cards, which made
 * it a second copy of 集數管理: you clicked 小說編輯 and landed on something
 * that looked like the episode list, because it was one.
 *
 * A writer arriving here wants one of three things: carry on where they left
 * off, see how far the book has got, or work on the outline. So that is what
 * this page is, and the full 120-episode directory stays in 集數管理 where it
 * belongs. The prose itself still lives at `/episodes/[episodeId]/novel`,
 * one document per episode — spec v3 §11.1「不得造成兩份正文」.
 */
export default async function NovelWorkbenchPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [rows, outline, fx, provider, readiness] = await Promise.all([
    novelIndex(project.id),
    listOutline(project.id),
    getFxRates(),
    providerStatus(),
    projectReadiness(project.id),
  ])

  const novelTitle = novelTitleOf(project)
  const written = rows.filter((row) => row.charCount > 0)
  const totalChars = rows.reduce((n, row) => n + row.charCount, 0)

  /*
   * Where 「繼續寫作」 goes: the episode touched most recently, or the first
   * one not yet started. Landing a writer on EP001 every time is why the old
   * page felt like a directory rather than a desk.
   */
  const lastEdited = rows
    .filter((row) => row.updatedAt && row.charCount > 0)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))[0]
  const firstUnwritten = rows.find((row) => row.charCount === 0)
  const resume = lastEdited ?? firstUnwritten ?? rows[0]

  const outlineRows = outline.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    logline: row.logline,
    synopsis: row.synopsis,
    status: row.status,
    charCount: row.charCount,
  }))

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <PenLine aria-hidden className="size-4 text-accent-400" />
          小說工作台
        </h2>
        {/*
          The novel can be published under a different name from the work and
          the short drama (`@/lib/project-titles`); this is the page where that
          name belongs. Shown only when it actually differs.
        */}
        {novelTitle !== project.title && (
          <p className="text-[11px] text-ink-400">
            書名<span className="ml-1 text-ink-200">{novelTitle}</span>
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          {written.length > 0 && (
            <Link
              href={`/read/${project.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100"
            >
              <BookOpen aria-hidden className="size-3.5" />
              閱讀
            </Link>
          )}
          <NovelExportMenu
            projectId={project.id}
            episodes={written.map((row) => ({
              episodeId: row.episodeId,
              number: row.number,
              title: row.title,
              charCount: row.charCount,
            }))}
          />
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="尚未建立集數"
          description="小說是以集為單位撰寫的。先在「集數管理」建立集數，再回來動筆。"
          icon={<FileText aria-hidden className="size-5 text-ink-500" />}
          className="py-20"
        />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <ResumeCard projectId={project.id} resume={resume} />

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
              {/*
                標清楚是哪一種算法 (Z123)。四種細項在編輯器頁尾——那裡才是
                寫的時候會盯著看的地方，而這裡重算四種要讀 120 集全文。
              */}
              <Stat
                label="總字數"
                value={totalChars.toLocaleString('en-US')}
                unit="字（含標點，不含空白）"
              />
              <Stat label="已動筆" value={`${written.length}`} unit={`/ ${rows.length} 集`} />
              <Stat
                label="已寫大綱"
                value={`${outline.filter((row) => row.logline.trim() || row.synopsis.trim()).length}`}
                unit={`/ ${outline.length} 集`}
              />
              <Stat
                label="平均每集"
                value={
                  written.length > 0
                    ? Math.round(totalChars / written.length).toLocaleString('en-US')
                    : '—'
                }
                unit="字"
              />
            </dl>
          </div>

          <OutlineBoard
            projectId={project.id}
            episodes={outlineRows}
            canWrite={can(user, 'episode.write')}
            currency={user.displayCurrency}
            fx={fx}
            providerReady={provider.available}
            {...(provider.detail ? { providerDetail: provider.detail } : {})}
            readiness={readiness}
          />

          {written.length > 0 && <RecentlyEdited projectId={project.id} rows={written} />}
        </>
      )}
    </div>
  )
}

function ResumeCard({
  projectId,
  resume,
}: {
  projectId: string
  resume: { episodeId: string; number: number; title: string; charCount: number } | undefined
}) {
  if (!resume) return null

  const label = `EP${String(resume.number).padStart(3, '0')}`
  const started = resume.charCount > 0

  return (
    <Link
      href={`/projects/${projectId}/episodes/${resume.episodeId}/novel`}
      className="panel group flex flex-col justify-between gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700 transition-all hover:ring-accent-500/50"
    >
      <div className="flex items-center gap-2">
        <BookOpen aria-hidden className="size-4 text-accent-400" />
        <span className="text-xs font-semibold text-ink-100">
          {started ? '繼續寫作' : '開始寫作'}
        </span>
      </div>

      <div>
        <p className="text-sm font-medium text-ink-50">
          {label}
          <span className="ml-2 text-xs font-normal text-ink-400">
            {resume.title || '未命名'}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-ink-600">
          {started ? `已寫 ${resume.charCount.toLocaleString('en-US')} 字` : '尚未動筆'}
        </p>
      </div>
    </Link>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="panel flex flex-col gap-0.5 rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700">
      <dt className="text-[10px] text-ink-600">{label}</dt>
      <dd className="text-lg leading-tight font-semibold text-ink-50 tabular-nums">
        {value}
        <span className="ml-1 text-[10px] font-normal text-ink-500">{unit}</span>
      </dd>
    </div>
  )
}

function RecentlyEdited({
  projectId,
  rows,
}: {
  projectId: string
  rows: {
    episodeId: string
    number: number
    title: string
    charCount: number
    lastEditorName: string | null
    updatedAt: Date | null
  }[]
}) {
  const recent = [...rows]
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
    .slice(0, 6)

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink-300">最近編輯</h3>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {recent.map((row) => (
          <li key={row.episodeId}>
            <Link
              href={`/projects/${projectId}/episodes/${row.episodeId}/novel`}
              className="panel flex items-center gap-2 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700 transition-all hover:ring-stage-600"
            >
              <span className="text-[11px] font-medium text-ink-300 tabular-nums">
                EP{String(row.number).padStart(3, '0')}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                {row.title || <span className="text-ink-600">未命名</span>}
              </span>
              <span className="shrink-0 text-[10px] text-ink-600">
                {row.charCount.toLocaleString('en-US')} 字
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * How much the AI has to work from.
 *
 * Counted on the server so the generator dialog can warn *before* a run is
 * paid for, rather than after a refusal.
 */
async function projectReadiness(projectId: string): Promise<ProjectReadiness> {
  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { and, eq, isNull, sql } = await import('drizzle-orm')

  const [characters] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      detailed: sql<number>`count(*) filter (
        where length(trim(personality)) > 0 or length(trim(background)) > 0
      )`.mapWith(Number),
    })
    .from(schema.characters)
    .where(and(eq(schema.characters.projectId, projectId), isNull(schema.characters.deletedAt)))

  const [world] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.worldEntries)
    .where(and(eq(schema.worldEntries.projectId, projectId), isNull(schema.worldEntries.deletedAt)))

  const [episodes] = await db
    .select({
      outlined: sql<number>`count(*) filter (
        where length(trim(logline)) > 0 or length(trim(synopsis)) > 0
      )`.mapWith(Number),
    })
    .from(schema.episodes)
    .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))

  const [row] = await db
    .select({ synopsis: schema.projects.synopsis })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1)

  return {
    characters: characters?.total ?? 0,
    charactersWithDetail: characters?.detailed ?? 0,
    worldEntries: world?.total ?? 0,
    episodesWithOutline: episodes?.outlined ?? 0,
    hasSynopsis: Boolean(row?.synopsis.trim()),
  }
}

/** Whether a text provider is configured, and why not when it isn't. */
async function providerStatus(): Promise<{ available: boolean; detail?: string }> {
  try {
    const resolved = await adapterForTask('OUTLINE_GENERATE', null)
    if (!resolved) return { available: false, detail: '尚未設定任何可用的 AI 供應商。' }
    const status = await resolved.adapter.status()
    return { available: status.available, detail: status.detail }
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : undefined,
    }
  }
}
