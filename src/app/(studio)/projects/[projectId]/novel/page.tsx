import { AudioLines, BookOpen, FileText, PenLine, TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ImportButton } from '@/components/studio/ImportButton'
import { NovelExportMenu } from '@/components/studio/NovelExportMenu'
import { OutlineBoard } from '@/components/studio/OutlineBoard'
import { EmptyState } from '@/components/ui/StateViews'
import { adapterForTask } from '@/lib/ai/jobs'
import { audiobooksByEpisode } from '@/lib/assets'
import { attributionStatus } from '@/lib/attribution-job'
import { getSessionUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listOutline } from '@/lib/episodes'
import { requireProjectPage } from '@/lib/project-access'
import { novelTitleOf } from '@/lib/project-titles'
import type { ProjectReadiness } from '@/lib/ai/readiness'
import { getFxRates } from '@/lib/settings'
import { formatDurationZh } from '@/lib/utils'
import {
  episodeLabel,
  voiceReadiness,
  type VoiceEpisodeInput,
  type VoiceEpisodeRow,
} from '@/lib/voice-readiness'
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

  const [rows, outline, fx, provider, readiness, audio] = await Promise.all([
    novelIndex(project.id),
    listOutline(project.id),
    getFxRates(),
    providerStatus(),
    projectReadiness(project.id),
    audiobooksByEpisode(project.id),
  ])

  /*
   * 歸屬狀態要等 `rows`，所以不在上面那一批裡：它吃的是集數 id (Z147)。
   * 一次查完，不是每集一次——120 集的頁面不能有 N+1。
   */
  const attribution = await attributionStatus(rows.map((row) => row.episodeId))

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
          {/*
            匯入 (Z186)。放在匯出旁邊：這兩件事是同一組動作，而把匯入藏在集
            數頁裡會讓「我有十集的稿子」變成開十次頁面。
          */}
          <ImportButton
            projectId={project.id}
            episodes={rows.map((row) => ({
              id: row.episodeId,
              number: row.number,
              title: row.title,
            }))}
            target="chapters"
            episodeId={resume?.episodeId ?? null}
            label="匯入小說"
          />
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

          {written.length > 0 && (
            <VoiceReadiness
              projectId={project.id}
              rows={written.map((row) => ({
                episodeId: row.episodeId,
                number: row.number,
                title: row.title,
                attribution: attribution.get(row.episodeId) ?? null,
                audio: audio.get(row.episodeId) ?? null,
              }))}
            />
          )}

          <OutlineBoard
            projectId={project.id}
            projectTitle={project.title}
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

/**
 * 跨集的對白歸屬與配音總覽 (Z147).
 *
 * 「現在只有一集有聲音？」——這個問題問過兩次，而在這之前回答它的唯一辦法是
 * 一集一集點開有聲分頁。所以這裡就是那個答案：哪幾集判過、哪幾集沒有、哪幾集
 * 已經有聲音。
 *
 * ## 只列有進度的那幾集
 *
 * 第一版列「已動筆的全部」，而這一頁下面是一張一百二十行的分集大綱——於是這
 * 一區被推到第一百二十行以下，截圖拍不到它，人也不會捲到那裡。**一個要捲過
 * 一百二十行才看得到的「一眼看完」不是一眼看完。**
 *
 * 所以搬到大綱上面，而且只列**判過或有聲音**的那幾集：沒進度的用一行總結。
 * 這樣它的高度跟進度成正比而不是跟集數成正比——一百二十集全部寫完的時候，
 * 列全部等於在大綱上面再放一張大綱。
 *
 * ## 不編分母
 *
 * 「判過 73 段」後面沒有 `/ 幾段`，因為那個分母要把整本書讀出來、逐段跑一次
 * 對白偵測——一個要讀完整本書才畫得出來的數字，會讓這一頁貴到沒有人想打開。
 * 而這個總覽要答的是「哪幾集判過」，沒有分母一樣答得出來。
 *
 * ## 判斷全部在 `@/lib/voice-readiness`
 *
 * 這裡只負責畫。那一支是純函式所以測得到，而這一區的兩個錯（把「判過但全是旁
 * 白」說成「沒判過」、先合成後判斷時警示會消失）都是判斷錯，不是畫錯。
 */
function VoiceReadiness({
  projectId,
  rows,
}: {
  projectId: string
  rows: VoiceEpisodeInput[]
}) {
  const summary = voiceReadiness(rows)

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-300">
          <AudioLines aria-hidden className="size-3.5 text-accent-400" />
          對白歸屬與配音
        </h3>
        <p className="text-[11px] text-ink-500">
          已動筆 {summary.written} 集：{summary.judgedCount} 集判過對白歸屬、
          {summary.voicedCount} 集做出有聲書
        </p>
        <Link
          href={`/read/${projectId}?tab=audio`}
          className="ml-auto text-[11px] text-accent-300 transition-opacity hover:opacity-80"
        >
          去逐集判斷與合成 →
        </Link>
      </div>

      {summary.stale.length > 0 && <StaleAudio rows={summary.stale} />}

      {summary.started.length === 0 ? (
        <p className="rounded-lg bg-stage-900 px-3 py-2.5 text-[11px] text-ink-500 ring-1 ring-stage-700">
          已動筆的 {summary.written} 集都還沒判過對白歸屬，也還沒有聲音。判斷一次之後，換音色
          重做都不必再問一遍。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-stage-800 overflow-hidden rounded-lg bg-stage-900 ring-1 ring-stage-700">
          {summary.started.map((row) => (
            <li
              key={row.episodeId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
            >
              <Link
                href={`/projects/${projectId}/episodes/${row.episodeId}/novel`}
                className="inline-flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80"
              >
                <span className="text-[11px] font-medium text-ink-300 tabular-nums">
                  {episodeLabel(row.number)}
                </span>
                <span className="min-w-0 truncate text-xs text-ink-200">
                  {row.title || <span className="text-ink-600">未命名</span>}
                </span>
              </Link>

              <span className="ml-auto text-[10px] text-ink-500 tabular-nums">
                {!row.judged ? (
                  <span className="text-ink-600">沒判過</span>
                ) : (
                  <>
                    判過 {row.attribution?.judged.toLocaleString('en-US')} 段
                    <span className="mx-1 text-ink-700">·</span>
                    {row.hasSpeakers ? (
                      <>{row.attribution?.speakers} 人</>
                    ) : (
                      /* 判過了，而答案是整集沒有人說話。那不是「沒判過」。 */
                      <span className="text-ink-600">全是旁白</span>
                    )}
                    {(row.attribution?.manual ?? 0) > 0 && (
                      <>
                        <span className="mx-1 text-ink-700">·</span>
                        人工 {row.attribution?.manual}
                      </>
                    )}
                  </>
                )}
              </span>

              <span className="w-24 shrink-0 text-right text-[10px] tabular-nums">
                {row.audio ? (
                  <span className={row.freshness === 'ok' ? 'text-accent-300' : 'text-gilt-300'}>
                    {row.audio.durationSec ? formatDurationZh(row.audio.durationSec) : '有聲書'}
                  </span>
                ) : (
                  <span className="text-ink-700">沒聲音</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {summary.untouched > 0 && summary.started.length > 0 && (
        <p className="text-[10px] text-ink-600">
          其餘 {summary.untouched} 集已動筆但還沒判過，也還沒有聲音。
        </p>
      )}
    </section>
  )
}

/**
 * 這幾集的音檔裡只有一個聲音。
 *
 * 配音在沒有說話人時會退回規則，而規則在這部小說上一句都判不出來
 * （`audiobook/route.ts` 的註解寫著同一件事）。那些音檔是成功產出的、檔案好好
 * 的、時長也對——只是裡面只有一個人在唸。不標出來的話，這件事要等到有人把三
 * 十五分鐘聽完才會發現。
 *
 * 兩種成因分開寫，因為**下一步不一樣**：沒有說話人要先去判斷，而「音檔比歸屬
 * 舊」是判斷已經有了、只差重新合成一次。
 */
function StaleAudio({ rows }: { rows: VoiceEpisodeRow[] }) {
  const noSpeakers = rows.filter((row) => row.freshness === 'no-speakers')
  const outdated = rows.filter((row) => row.freshness === 'outdated')
  const label = (list: VoiceEpisodeRow[]) =>
    list.map((row) => episodeLabel(row.number)).join('、')

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-gilt-400/10 px-3 py-2 text-[11px] text-gilt-200 ring-1 ring-gilt-400/25">
      {noSpeakers.length > 0 && (
        <p className="inline-flex items-start gap-1.5">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {label(noSpeakers)} 有聲書做好了，但這一集
            {noSpeakers.every((row) => row.judged) ? '判過之後沒有任何人說話' : '沒判過對白歸屬'}
            ——配音會退回規則，而規則在這部小說上一句都判不出來，所以
            <strong className="font-semibold text-gilt-100">整集都是旁白的聲音</strong>。
            要分角色的話，先判斷再重新合成。
          </span>
        </p>
      )}
      {outdated.length > 0 && (
        <p className="inline-flex items-start gap-1.5">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {label(outdated)} 的有聲書是
            <strong className="font-semibold text-gilt-100">在對白歸屬之前做的</strong>
            ——音檔裡用的是當時的歸屬（也就是沒有），所以還是一個人唸到底。判斷已經有了，
            重新合成一次就會分角色。
          </span>
        </p>
      )}
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
