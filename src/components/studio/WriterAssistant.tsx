'use client'

import {
  Anchor,
  Archive,
  Check,
  ChevronRight,
  Download,
  Loader2,
  MessageCircleHeart,
  Lock,
  Scale,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { RichText } from '@/components/assistant/RichText'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { AUDIT_RULES, AUDIT_SKILLS } from '@/lib/ai/audit-rules'
import {
  asEpisodeAudit,
  asStoryDigest,
  asTurns,
  AUDIT_QUESTIONS,
  REPORT_KIND_LABEL,
  VERDICT_HINT,
  VERDICT_LABEL,
  asVerdicts,
  type AskTurn,
  type AuditBeat,
  type AuditDoubt,
  type EpisodeAudit,
  type DoubtVerdict,
  type SavedReport,
  type StoryDigest,
  type VerdictCode,
  type WriterReportKind,
} from '@/lib/ai/story-audit-view'
import { cn } from '@/lib/utils'

/**
 * 編劇助手（Z198）。
 *
 * 暖寶要的是「**整理給我看**」，所以這一頁沒有一個要貼內容的輸入框——材料全部
 * 由伺服器端自己從資料庫湊齊。畫面上只有按鈕、一份報告，跟一個可以問問題的地方。
 *
 * ## 字級
 *
 * 第一版整頁 10–11px，被退回來兩次。**這一頁的內容是拿來讀的，不是介面標籤**：
 * 本文 15–16px、行高七，只有狀態與註解留小字。這跟專案其他頁面的密度不一樣，
 * 而那是刻意的——那些頁面是工作台，這一頁是一份報告。
 *
 * ## 回答不要露出 markdown 符號
 *
 * 模型會寫 `**粗體**` 跟 `- 條列`，而第一版用 `whitespace-pre-wrap` 直接把原
 * 字串印出來，於是讀的人看到的是一堆星號。改走 `RichText`（助理那邊早就有的
 * 那一支），它把那個子集渲染成 React 節點而不是 HTML——模型的輸出不該有機會
 * 變成標記。
 *
 * ## 一集一支請求
 *
 * 二十集一次跑完要五到十分鐘，而函式有執行時間上限。跑完一集就把那一集畫出
 * 來——她可以邊跑邊看。中途失敗的那一集留在原地標紅，不中斷其餘的。
 */

export type WriterEpisode = {
  episodeId: string
  number: number
  title: string
  chars: number
}

type EpisodeState = {
  status: 'idle' | 'running' | 'done' | 'failed'
  audit?: EpisodeAudit | null
  problem?: string | null
  error?: string
  /** 編劇視角判完的那一份（Z201）。 */
  verdicts?: DoubtVerdict[]
  /** 判的時候手上有沒有隱藏設定——沒有的話可信度完全不一樣。 */
  hadSecret?: boolean
}

const RULES_KEY = 'srds:writer-rules'

export function WriterAssistant({
  projectId,
  projectTitle,
  episodes,
  saved,
  withSecret,
  canRun,
}: {
  projectId: string
  projectTitle: string
  episodes: WriterEpisode[]
  /** 存進資料庫的那些，最新的在前面。 */
  saved: SavedReport[]
  /** 已經填過隱藏設定的集數 id——**只有 id，沒有內容**。 */
  withSecret: string[]
  canRun: boolean
}) {
  const toast = useToast()
  const router = useRouter()
  const [digest, setDigest] = useState<StoryDigest | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)
  const [states, setStates] = useState<Record<string, EpisodeState>>({})
  const [runningAll, setRunningAll] = useState(false)
  const [turns, setTurns] = useState<AskTurn[]>([])

  /*
   * 勾掉的準則要真的從提示詞裡消失。
   *
   * 存在 localStorage：這是一個偏好，不是資料。存進資料庫要一支遷移，而為了
   * 十四個核取方塊去改 schema 不划算——代價是它跟著這台裝置走，而畫面上有寫。
   */
  const [enabled, setEnabled] = useState<number[]>(() => AUDIT_RULES.map((_, i) => i))
  useEffect(() => {
    /*
     * 推到下一個 tick，因為 `localStorage` 在伺服器端渲染時不存在。
     *
     * **沒有 `restored.current` 那種守衛。** `FloatingChat` 有，而它在
     * StrictMode 下會把自己鎖死（Z196）。這裡多讀一次沒有任何代價。
     */
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(RULES_KEY)
        if (!stored) return
        const parsed = JSON.parse(stored) as unknown
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
          setEnabled(parsed as number[])
        }
      } catch {
        // 無痕視窗或被擋掉的儲存空間；預設值（全開）本來就是對的。
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const toggleRule = (index: number) => {
    setEnabled((current) => {
      const next = current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
      try {
        window.localStorage.setItem(RULES_KEY, JSON.stringify(next))
      } catch {
        // 存不起來就只是這一次有效，不值得打斷任何人。
      }
      return next
    })
  }

  const setOne = (episodeId: string, next: EpisodeState) =>
    setStates((current) => ({ ...current, [episodeId]: next }))

  async function runDigest() {
    if (digestBusy) return
    setDigestBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: enabled }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as {
        digest: { digest: StoryDigest | null; problem: string | null }
      }
      if (!body.digest.digest) {
        toast.error('整理不出來', body.digest.problem ?? undefined)
        return
      }
      setDigest(body.digest.digest)
    } catch (cause) {
      toast.error('整理失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setDigestBusy(false)
    }
  }

  async function runEpisode(episode: WriterEpisode): Promise<boolean> {
    setOne(episode.episodeId, { status: 'running' })
    try {
      const response = await apiFetch(`/api/projects/${projectId}/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episodeId: episode.episodeId, rules: enabled }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as {
        episode: { audit: EpisodeAudit | null; problem: string | null }
      }
      setOne(episode.episodeId, {
        status: body.episode.audit ? 'done' : 'failed',
        audit: body.episode.audit,
        problem: body.episode.problem,
        ...(body.episode.audit ? {} : { error: body.episode.problem ?? '讀不出來' }),
      })
      return Boolean(body.episode.audit)
    } catch (cause) {
      setOne(episode.episodeId, {
        status: 'failed',
        error: cause instanceof Error ? cause.message : '失敗',
      })
      return false
    }
  }

  /**
   * 編劇視角判一次（Z201）。
   *
   * 這是**第二次**呼叫，不是同一個對話的第二段：觀眾那一趟的 context 物件裡
   * 根本沒有隱藏設定那一欄。在同一個對話裡叫模型「假裝不知道」是一個請求，兩
   * 次獨立的呼叫才是一個保證。
   */
  async function judge(episode: WriterEpisode, doubts: EpisodeAudit['doubts']): Promise<void> {
    const response = await apiFetch(`/api/projects/${projectId}/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId: episode.episodeId,
        rules: enabled,
        judge: doubts.map((d) => ({ question: d.question, quote: d.quote, why: d.why })),
      }),
    })
    if (!response.ok) throw new Error(await readApiError(response))
    const body = (await response.json()) as {
      judge: { verdicts: DoubtVerdict[] | null; problem: string | null; hadSecret: boolean }
    }
    if (!body.judge.verdicts) {
      toast.error('判不出來', body.judge.problem ?? undefined)
      return
    }
    setStates((current) => ({
      ...current,
      [episode.episodeId]: {
        ...(current[episode.episodeId] ?? { status: 'done' }),
        verdicts: body.judge.verdicts!,
        hadSecret: body.judge.hadSecret,
      },
    }))
  }

  async function runAll() {
    if (runningAll) return
    setRunningAll(true)
    let failed = 0
    for (const episode of episodes) {
      const ok = await runEpisode(episode)
      if (!ok) failed += 1
    }
    setRunningAll(false)
    if (failed > 0) toast.error(`有 ${failed} 集沒整理出來`, '其餘的已經在下面了。')
  }

  async function ask(question: string, episodeId: string | null): Promise<void> {
    const response = await apiFetch(`/api/projects/${projectId}/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question,
        rules: enabled,
        history: turns.slice(-4),
        material: materialFor(digest, episodes, states),
        ...(episodeId ? { episodeId } : {}),
      }),
    })
    if (!response.ok) throw new Error(await readApiError(response))
    const body = (await response.json()) as { ask: { answer: string } }
    setTurns((current) => [...current, { question, answer: body.ask.answer }])
  }

  /**
   * 存進資料庫 (Z200).
   *
   * 存的是**已經解析好的結果**，不是模型回的原字串——原字串要重新解析才畫得
   * 出來，而解析器會改。存結果的話，畫面永遠畫得出來。
   */
  async function save(input: {
    kind: WriterReportKind
    title: string
    payload: unknown
    episodeId?: string | null
  }): Promise<void> {
    const response = await apiFetch(`/api/projects/${projectId}/audit/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: input.kind,
        title: input.title,
        payload: input.payload,
        ...(input.episodeId ? { episodeId: input.episodeId } : {}),
      }),
    })
    if (!response.ok) throw new Error(await readApiError(response))
    toast.success('存好了', '可以在下面「存起來的」裡隨時點開。')
    // 伺服器端元件重新取一次，存起來的清單才會多那一列。
    router.refresh()
  }

  const done = episodes.filter((e) => states[e.episodeId]?.status === 'done').length
  const hasSomething = Boolean(digest) || done > 0 || turns.length > 0

  const report = () => ({
    作品: projectTitle,
    產生時間: new Date().toISOString(),
    採用的準則: AUDIT_RULES.filter((_, i) => enabled.includes(i)),
    主線與人設: digest,
    問答: turns,
    逐集: episodes
      .map((episode) => ({
        集數: episode.number,
        標題: episode.title,
        整理: states[episode.episodeId]?.audit ?? null,
      }))
      .filter((row) => row.整理 !== null),
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Hero
        episodeCount={episodes.length}
        done={done}
        digestBusy={digestBusy}
        runningAll={runningAll}
        canRun={canRun}
        onDigest={runDigest}
        onRunAll={runAll}
      />

      {digest && (
        <DigestView
          digest={digest}
          onSave={() =>
            save({ kind: 'DIGEST', title: `主線與人設・${stamp()}`, payload: digest })
          }
        />
      )}

      <AskPanel
        episodes={episodes}
        turns={turns}
        canRun={canRun}
        ready={Boolean(digest) || done > 0}
        onAsk={ask}
        onSave={() => save({ kind: 'ASK', title: `問答 ${turns.length} 則・${stamp()}`, payload: turns })}
      />

      {hasSomething && (
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton
            icon={<Download className="size-3.5" />}
            onClick={() =>
              download(
                `${projectTitle}-編劇審核.json`,
                JSON.stringify(report(), null, 2),
                'application/json'
              )
            }
          >
            存成 JSON
          </ChipButton>
          <ChipButton
            icon={<Download className="size-3.5" />}
            onClick={() =>
              download(
                `${projectTitle}-編劇審核.md`,
                toMarkdown(projectTitle, digest, episodes, states, enabled, turns),
                'text/markdown;charset=utf-8'
              )
            }
          >
            存成文件
          </ChipButton>
          <span className="text-xs text-ink-600">存的是畫面上現在有的，不會再跑一次</span>
        </div>
      )}

      {episodes.length === 0 ? (
        <EmptyState
          title="還沒有正文可以整理"
          description="先在小說編輯寫一集，這裡就會有東西可以看。"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {episodes.map((episode) => (
            <li key={episode.episodeId}>
              <EpisodeCard
                episode={episode}
                state={states[episode.episodeId]}
                canRun={canRun}
                onRun={() => void runEpisode(episode)}
                onSave={(audit) =>
                  save({
                    kind: 'EPISODE',
                    episodeId: episode.episodeId,
                    title: `第 ${episode.number} 集${episode.title ? `《${episode.title}》` : ''}・${stamp()}`,
                    payload: audit,
                  })
                }
                hasSecret={withSecret.includes(episode.episodeId)}
                onJudge={(doubts) => judge(episode, doubts)}
                onSaveVerdicts={(verdicts) =>
                  save({
                    kind: 'VERDICT',
                    episodeId: episode.episodeId,
                    title: `第 ${episode.number} 集的編劇判定・${stamp()}`,
                    payload: verdicts,
                  })
                }
                projectId={projectId}
              />
            </li>
          ))}
        </ul>
      )}

      <SavedPanel projectId={projectId} saved={saved} canRun={canRun} />

      <RulesPanel enabled={enabled} onToggle={toggleRule} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 最上面那一塊。
 *
 * 做得比其他面板搶眼一點，因為這一頁只有一個起點——不按它什麼都不會發生。而
 * 「逐集看」那一顆會跑好幾分鐘，所以它自己帶一條進度。
 */
function Hero({
  episodeCount,
  done,
  digestBusy,
  runningAll,
  canRun,
  onDigest,
  onRunAll,
}: {
  episodeCount: number
  done: number
  digestBusy: boolean
  runningAll: boolean
  canRun: boolean
  onDigest: () => void
  onRunAll: () => void
}) {
  const pct = episodeCount > 0 ? Math.round((done / episodeCount) * 100) : 0

  return (
    <section className="panel relative overflow-hidden rounded-2xl bg-stage-900 ring-1 ring-stage-700">
      {/* 頂上一條漸層，讓它跟底下那一排報告卡片分得開。 */}
      <div aria-hidden className="bg-brand-gradient h-1 w-full" />

      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="bg-brand-gradient glow-accent-sm grid size-10 shrink-0 place-items-center rounded-2xl text-white"
          >
            <Wand2 className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-lg font-semibold tracking-tight text-ink-50">整理給我看</h2>
            <p className="text-sm text-ink-400">
              材料直接從這部作品裡讀，不用貼。目前有 {episodeCount} 集有正文。
            </p>
          </div>
        </div>

        <ul className="flex flex-wrap gap-2">
          {AUDIT_QUESTIONS.map((question) => (
            <li
              key={question}
              className="rounded-full bg-stage-850 px-3 py-1.5 text-[13px] text-ink-300 ring-1 ring-stage-700"
            >
              {question}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2.5">
          <BigButton
            primary
            busy={digestBusy}
            disabled={!canRun}
            onClick={onDigest}
            icon={<Sparkles className="size-4" />}
            title={canRun ? undefined : '你的角色不能跑 AI 任務'}
          >
            {digestBusy ? '正在讀整部戲…' : '整理主線與人設'}
          </BigButton>

          <BigButton
            busy={runningAll}
            disabled={!canRun || episodeCount === 0}
            onClick={onRunAll}
            icon={<Anchor className="size-4" />}
            title={canRun ? undefined : '你的角色不能跑 AI 任務'}
          >
            {runningAll
              ? `整理中… ${done} / ${episodeCount}`
              : `逐集看爽點與鉤子（${episodeCount} 集）`}
          </BigButton>

          {done > 0 && !runningAll && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-300">
              <Check className="size-3.5" />
              已整理 {done} 集
            </span>
          )}
        </div>

        {(runningAll || done > 0) && (
          <div className="flex items-center gap-3">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-800">
              <div
                className="bg-brand-gradient h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-ink-500 tabular-nums">{pct}%</span>
          </div>
        )}

        <p className="text-xs leading-relaxed text-ink-600">
          一集一支請求，跑完一集就出現一塊，可以邊跑邊看。這會花錢（算在成本中心的 AI
          那一欄），每次重跑都是一次新的花費。
        </p>
      </div>
    </section>
  )
}

function BigButton({
  children,
  icon,
  onClick,
  busy = false,
  disabled = false,
  primary = false,
  title,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  primary?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={cn(
        'tap inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all',
        'disabled:cursor-not-allowed disabled:opacity-50',
        primary
          ? 'bg-brand-gradient glow-accent-sm text-white hover:brightness-110'
          : 'bg-stage-850 text-ink-200 ring-1 ring-stage-700 hover:bg-stage-800 hover:text-ink-50',
        !disabled && !busy && 'hover:-translate-y-0.5 active:translate-y-0'
      )}
    >
      <span aria-hidden>{busy ? <Loader2 className="size-4 animate-spin" /> : icon}</span>
      {children}
    </button>
  )
}

function ChipButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap inline-flex items-center gap-1.5 rounded-full bg-stage-850 px-3 py-1.5 text-[13px] text-ink-300 ring-1 ring-stage-700 transition-all hover:-translate-y-0.5 hover:text-ink-50"
    >
      <span aria-hidden className="text-accent-400">
        {icon}
      </span>
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */

function DigestView({ digest, onSave }: { digest: StoryDigest; onSave?: () => Promise<void> }) {
  return (
    <section className="panel flex flex-col gap-5 rounded-2xl bg-stage-900 p-5 ring-1 ring-stage-700 sm:p-6">
      {onSave && (
        <div className="flex justify-end">
          <SaveButton onSave={onSave} />
        </div>
      )}

      <Section title="目前的主線" icon="📖">
        <p className="text-base leading-8 whitespace-pre-wrap text-ink-100">{digest.mainline}</p>
      </Section>

      {digest.threads.length > 0 && (
        <Section title="支線" icon="🧵">
          <ul className="flex flex-col gap-2">
            {digest.threads.map((thread) => (
              <li
                key={thread}
                className="flex gap-2.5 rounded-xl bg-stage-850/60 px-3.5 py-2.5 text-[15px] leading-7 text-ink-200"
              >
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent-400" />
                {thread}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {digest.characters.length > 0 && (
        <Section title="人設現況" icon="🎭">
          <div className="grid gap-3 sm:grid-cols-2">
            {digest.characters.map((person) => (
              <div
                key={person.name}
                className="flex flex-col gap-2 rounded-2xl bg-stage-850 p-4 ring-1 ring-stage-700/60 transition-all hover:ring-accent-500/40"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="bg-brand-gradient grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
                  >
                    {person.name.slice(0, 1)}
                  </span>
                  <span className="text-base font-medium text-ink-50">{person.name}</span>
                </div>
                {person.now && <Line label="現在" value={person.now} />}
                {person.wants && <Line label="想要" value={person.wants} />}
                {person.changed && <Line label="變化" value={person.changed} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {digest.issues.length > 0 && (
        <Section title="跨集的問題" icon="🔍">
          <ul className="flex flex-col gap-3">
            {digest.issues.map((issue) => (
              <li key={issue.question}>
                <DoubtView doubt={issue} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </section>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink-100">
        <span aria-hidden className="text-base">
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-2 text-[15px] leading-7">
      <span className="shrink-0 rounded-md bg-stage-800 px-1.5 text-[12px] leading-6 text-ink-500">
        {label}
      </span>
      <span className="min-w-0 text-ink-300">{value}</span>
    </p>
  )
}

/* -------------------------------------------------------------------------- */

function EpisodeCard({
  episode,
  state,
  canRun,
  hasSecret,
  onRun,
  onSave,
  onJudge,
  onSaveVerdicts,
  projectId,
}: {
  episode: WriterEpisode
  state: EpisodeState | undefined
  canRun: boolean
  hasSecret: boolean
  onRun: () => void
  onSave: (audit: EpisodeAudit) => Promise<void>
  onJudge: (doubts: EpisodeAudit['doubts']) => Promise<void>
  onSaveVerdicts: (verdicts: DoubtVerdict[]) => Promise<void>
  projectId: string
}) {
  const status = state?.status ?? 'idle'

  return (
    <section
      className={cn(
        'panel flex flex-col gap-4 rounded-2xl bg-stage-900 p-5 ring-1 transition-all sm:p-6',
        status === 'running' ? 'ring-accent-500/50' : 'ring-stage-700/60'
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl text-sm font-semibold tabular-nums transition-colors',
            status === 'done'
              ? 'bg-brand-gradient text-white'
              : 'bg-stage-800 text-ink-500 ring-1 ring-stage-700'
          )}
        >
          {episode.number}
        </span>

        <div className="flex min-w-0 flex-col">
          <span className="text-base font-medium text-ink-50">
            {episode.title ? `《${episode.title}》` : `第 ${episode.number} 集`}
          </span>
          <span className="text-xs text-ink-600 tabular-nums">
            {episode.chars.toLocaleString('en-US')} 字
          </span>
        </div>

        <span className="ml-auto flex items-center gap-2">
          {state?.audit && <SaveButton onSave={() => onSave(state.audit!)} />}
          {status === 'running' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/15 px-3 py-1.5 text-[13px] text-accent-200">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              正在讀…
            </span>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              title={canRun ? undefined : '你的角色不能跑 AI 任務'}
              className="tap rounded-full bg-stage-850 px-3 py-1.5 text-[13px] text-ink-400 ring-1 ring-stage-700 transition-all hover:-translate-y-0.5 hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'idle' ? '整理這一集' : '再整理一次'}
            </button>
          )}
        </span>
      </header>

      {status === 'failed' && (
        <p className="rounded-xl bg-rose-950/40 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-900/60">
          {state?.error ?? '讀不出來'}
        </p>
      )}

      {state?.audit && (
        <AuditView
          audit={state.audit}
          verdicts={state.verdicts}
          hadSecret={state.hadSecret}
          canRun={canRun}
          onJudge={onJudge}
          onSaveVerdicts={onSaveVerdicts}
        />
      )}

      {state?.audit && (
        <SecretBox
          projectId={projectId}
          episodeId={episode.episodeId}
          canRun={canRun}
          hasSecret={hasSecret}
        />
      )}
    </section>
  )
}

function AuditView({
  audit,
  verdicts,
  hadSecret,
  canRun,
  onJudge,
  onSaveVerdicts,
}: {
  audit: EpisodeAudit
  verdicts?: DoubtVerdict[]
  hadSecret?: boolean
  canRun?: boolean
  onJudge?: (doubts: EpisodeAudit['doubts']) => Promise<void>
  onSaveVerdicts?: (verdicts: DoubtVerdict[]) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <BeatCard label="爽點" icon="✨" beat={audit.payoff} tone="payoff" />
        <BeatCard label="鉤子" icon="🪝" beat={audit.hook} tone="hook" />
      </div>

      {audit.events.length > 0 && (
        <details className="group rounded-xl bg-stage-850/50 px-4 py-3">
          <summary className="tap cursor-pointer list-none text-sm text-ink-400 transition-colors hover:text-ink-100">
            <span
              aria-hidden
              className="mr-1.5 inline-block transition-transform group-open:rotate-90"
            >
              ›
            </span>
            本集事件（{audit.events.length}）
          </summary>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-6 text-[15px] leading-7 text-ink-300">
            {audit.events.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ol>
        </details>
      )}

      {audit.details.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-300">
            <span aria-hidden>🔎</span> 細節
          </h4>
          <ul className="flex flex-col gap-2.5">
            {audit.details.map((note) => (
              <li
                key={note.issue}
                className="flex flex-col gap-1.5 rounded-xl bg-amber-950/20 px-4 py-3 ring-1 ring-amber-900/40"
              >
                <span className="text-[15px] leading-7 text-ink-200">{note.issue}</span>
                {note.quote && <Quote text={note.quote} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {audit.doubts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-200">
              <span aria-hidden>🤔</span> 讀到這裡會卡住的地方
            </h4>
            <span className="text-xs text-ink-600">這是**觀眾視角**，它看不到後面</span>

            {onJudge && (
              <span className="ml-auto flex items-center gap-2">
                {verdicts && onSaveVerdicts && (
                  <SaveButton onSave={() => onSaveVerdicts(verdicts)} />
                )}
                <JudgeButton
                  canRun={Boolean(canRun)}
                  again={Boolean(verdicts)}
                  onJudge={() => onJudge(audit.doubts)}
                />
              </span>
            )}
          </div>

          {verdicts && hadSecret === false && (
            <p className="rounded-xl bg-amber-950/25 px-4 py-2.5 text-[13px] leading-relaxed text-amber-200/90 ring-1 ring-amber-900/40">
              這一集還沒有填隱藏設定，所以編劇視角也不知道後面會怎麼寫——它只能靠正文判，
              多半會落在「資料不足」。填了再判一次會準得多。
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {audit.doubts.map((doubt) => (
              <li key={doubt.question}>
                <DoubtView
                  doubt={doubt}
                  verdict={verdicts?.find((v) => v.question === doubt.question)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 爽點與鉤子。
 *
 * 這兩格是暖寶最想看的東西，所以它們長得跟別的不一樣：有顏色、有圖示、原文直
 * 接攤開不要摺起來。沒有的時候**不要畫成錯誤**——「這一集沒有爽點」是一個發
 * 現，不是一個故障。
 */
function BeatCard({
  label,
  icon,
  beat,
  tone,
}: {
  label: string
  icon: string
  beat: AuditBeat
  tone: 'payoff' | 'hook'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-2xl p-4 ring-1 transition-all',
        beat.present
          ? tone === 'payoff'
            ? 'bg-gradient-to-br from-emerald-950/50 to-stage-900 ring-emerald-800/50'
            : 'bg-gradient-to-br from-stage-750 to-stage-900 ring-accent-700/50'
          : 'bg-stage-850/60 ring-stage-700/60'
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-base">
          {icon}
        </span>
        <span className="text-[15px] font-semibold text-ink-50">{label}</span>
        {!beat.present && (
          <span className="rounded-full bg-stage-800 px-2 py-0.5 text-xs text-amber-300">沒有</span>
        )}
        {beat.where && <span className="ml-auto truncate text-xs text-ink-500">{beat.where}</span>}
      </div>

      <p className="text-[15px] leading-7 text-ink-100">{beat.what || '——'}</p>
      {beat.quote && <Quote text={beat.quote} />}
    </div>
  )
}

function DoubtView({ doubt, verdict }: { doubt: AuditDoubt; verdict?: DoubtVerdict }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl px-4 py-3 ring-1',
        verdict ? VERDICT_STYLE[verdict.verdict] : 'bg-stage-850/60 ring-stage-700/50'
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        {verdict && <VerdictChip code={verdict.verdict} />}
        <span className="min-w-0 flex-1 text-[15px] leading-7 text-ink-100">
          {doubt.question}
        </span>
      </div>

      {doubt.why && <span className="text-sm leading-6 text-ink-400">{doubt.why}</span>}
      {doubt.quote && <Quote text={doubt.quote} />}

      {verdict && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-stage-700/50 pt-2.5">
          <p className="flex gap-2 text-sm leading-7">
            <span className="shrink-0 rounded-md bg-stage-800 px-1.5 text-[12px] leading-6 text-ink-500">
              編劇
            </span>
            <span className="min-w-0 text-ink-200">{verdict.because}</span>
          </p>
          {verdict.fix && (
            <p className="flex gap-2 text-sm leading-7">
              <span className="shrink-0 rounded-md bg-accent-500/20 px-1.5 text-[12px] leading-6 text-accent-200">
                怎麼改
              </span>
              <span className="min-w-0 text-ink-200">{verdict.fix}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 四種判定的顏色。
 *
 * **「合理留白」不是警告**：那是一個「不用改」的結論，所以它是綠的。第一版把
 * 四種都畫成同一個灰，結果整份報告讀起來像四十條待辦。
 */
const VERDICT_STYLE: Record<VerdictCode, string> = {
  HELD_BACK: 'bg-emerald-950/25 ring-emerald-900/40',
  UNDER_SEEDED: 'bg-amber-950/25 ring-amber-900/40',
  REAL_HOLE: 'bg-rose-950/30 ring-rose-900/50',
  NOT_ENOUGH_INFO: 'bg-stage-850/60 ring-stage-700/50',
}

const VERDICT_CHIP: Record<VerdictCode, string> = {
  HELD_BACK: 'bg-emerald-500/15 text-emerald-300 ring-emerald-700/50',
  UNDER_SEEDED: 'bg-amber-500/15 text-amber-300 ring-amber-700/50',
  REAL_HOLE: 'bg-rose-500/15 text-rose-300 ring-rose-700/50',
  NOT_ENOUGH_INFO: 'bg-stage-800 text-ink-400 ring-stage-600',
}

function VerdictChip({ code }: { code: VerdictCode }) {
  return (
    <span
      title={VERDICT_HINT[code]}
      className={cn(
        'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        VERDICT_CHIP[code]
      )}
    >
      {VERDICT_LABEL[code]}
    </span>
  )
}

function JudgeButton({
  canRun,
  again,
  onJudge,
}: {
  canRun: boolean
  again: boolean
  onJudge: () => Promise<void>
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      await onJudge()
    } catch (cause) {
      toast.error('判不出來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={!canRun || busy}
      title={
        canRun
          ? '它會拿到這一集的隱藏設定，判斷每一條是刻意留白還是真的漏了'
          : '你的角色不能跑 AI 任務'
      }
      className={cn(
        'tap inline-flex items-center gap-1.5 rounded-full bg-stage-850 px-3 py-1.5 text-[13px] text-ink-300 ring-1 ring-stage-700 transition-all',
        'hover:-translate-y-0.5 hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0'
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <Scale aria-hidden className="size-3.5" />
      )}
      {again ? '再判一次' : '用編劇視角判一次'}
    </button>
  )
}

/**
 * 編劇已確認的隱藏設定（Z201）。
 *
 * 預設收合，而且標題不透露內容——這一塊是劇透，不該在捲動經過的時候被看到。
 */
function SecretBox({
  projectId,
  episodeId,
  canRun,
  hasSecret,
}: {
  projectId: string
  episodeId: string
  canRun: boolean
  /** 已經填過了嗎。**只是一個布林，不是內容。** */
  hasSecret: boolean
}) {
  const toast = useToast()
  const [notes, setNotes] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  /** 展開的時候才去拿——這一欄是劇透，不要在頁面載入時就撈進瀏覽器。 */
  async function load() {
    if (loaded) return
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/secret`
      )
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as { notes: string }
      setNotes(body.notes)
      setLoaded(true)
    } catch (cause) {
      toast.error('讀不到隱藏設定', cause instanceof Error ? cause.message : undefined)
    }
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/secret`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success('存好了', '下次判定就會用到。')
      setDirty(false)
    } catch (cause) {
      toast.error('存不起來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details
      className="group rounded-xl bg-stage-950/40 ring-1 ring-stage-700/50"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void load()
      }}
    >
      <summary className="tap flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-ink-400 transition-colors hover:text-ink-100">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-ink-600 transition-transform group-open:rotate-90"
        />
        <Lock aria-hidden className="size-3.5 text-ink-600" />
        編劇已確認的隱藏設定
        {hasSecret ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
            已填
          </span>
        ) : (
          <span className="rounded-full bg-stage-800 px-2 py-0.5 text-xs text-ink-500">
            還沒填
          </span>
        )}
        <span className="text-xs text-ink-600">只有「編劇視角」那一趟看得到</span>
      </summary>

      <div className="flex flex-col gap-2.5 border-t border-stage-700/50 p-4">
        <textarea
          value={notes}
          rows={4}
          maxLength={20_000}
          disabled={!canRun || busy || !loaded}
          placeholder={
            loaded
              ? '例如：梅花印其實是沈家與許家的共營商契，第 28 集才揭曉。許山河知道，但他要等沈知味自己查出來。'
              : '讀取中…'
          }
          onChange={(event) => {
            setNotes(event.target.value)
            setDirty(true)
          }}
          className="w-full resize-y rounded-xl bg-stage-950 px-4 py-3 text-[15px] leading-7 text-ink-50 ring-1 ring-stage-700 outline-none placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500/60 disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-600">
            寫後面會怎麼交代。觀眾視角那一趟**拿不到這一段**——它是另一次獨立的呼叫，
            連欄位都沒有。
          </p>
          <BigButton
            primary
            busy={busy}
            disabled={!canRun || !dirty}
            onClick={submit}
            icon={<Lock className="size-4" />}
          >
            存設定
          </BigButton>
        </div>
      </div>
    </details>
  )
}

/** 原文引文。沒有引文的判斷在這份報告裡沒有用，所以它要看得出來是原文。 */
function Quote({ text }: { text: string }) {
  return (
    <p className="rounded-lg border-l-[3px] border-accent-500/60 bg-stage-950/50 py-2 pr-3 pl-3 text-sm leading-7 text-ink-300">
      {text}
    </p>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 問它問題。
 *
 * 報告是唯讀的，而讀完一定會有問題——「第 7 集這個爽點我覺得不夠」「馬大後來
 * 怎麼不見了」。沒有地方問的話，這一頁就只是一份印出來的紙。
 *
 * **問答留在報告裡**，匯出的時候一起帶走。代價是重新整理頁面就沒了——要留下來
 * 得開一張表，那是下一步。
 */
function AskPanel({
  episodes,
  turns,
  canRun,
  ready,
  onAsk,
  onSave,
}: {
  episodes: WriterEpisode[]
  turns: AskTurn[]
  canRun: boolean
  ready: boolean
  onAsk: (question: string, episodeId: string | null) => Promise<void>
  onSave: () => Promise<void>
}) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [episodeId, setEpisodeId] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // 新的回答進來就捲到底，不然要自己找它跑到哪裡去了。
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [turns.length])

  async function submit() {
    const question = draft.trim()
    if (!question || busy) return
    setBusy(true)
    try {
      await onAsk(question, episodeId || null)
      setDraft('')
    } catch (cause) {
      toast.error('問不到答案', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel flex flex-col gap-4 rounded-2xl bg-stage-900 p-5 ring-1 ring-stage-700 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-2xl bg-accent-500/15 text-accent-300"
        >
          <MessageCircleHeart className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-base font-semibold text-ink-50">有問題就問它</h2>
          <p className="text-[13px] text-ink-500">它手上有上面整理好的東西，可以直接問。</p>
        </div>
        {turns.length > 0 && (
          <span className="ml-auto">
            <SaveButton onSave={onSave} />
          </span>
        )}
      </div>

      {turns.length > 0 && (
        <ul className="flex flex-col gap-5">
          {turns.map((turn, index) => (
            <li key={`${index}-${turn.question}`} className="flex flex-col gap-3">
              {/* 問句靠右，像訊息；回答靠左攤開，像一段文章。 */}
              <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-600/25 px-4 py-2.5 text-[15px] leading-7 text-ink-50 ring-1 ring-accent-500/30">
                {turn.question}
              </p>
              <div className="flex gap-2.5">
                <span
                  aria-hidden
                  className="bg-brand-gradient mt-1 grid size-7 shrink-0 place-items-center rounded-full text-white"
                >
                  <Wand2 className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-stage-850/70 px-4 py-3 ring-1 ring-stage-700/60">
                  {/* RichText：模型會寫 **粗體** 跟條列，直接印會變成一堆星號。 */}
                  <RichText text={turn.answer} size="lg" />
                </div>
              </div>
            </li>
          ))}
          <div ref={endRef} />
        </ul>
      )}

      <div className="flex flex-col gap-2.5">
        <textarea
          value={draft}
          rows={2}
          maxLength={2000}
          disabled={!canRun || busy}
          placeholder={
            ready
              ? '例如：第 7 集的爽點我覺得不夠，可以怎麼加？'
              : '先按上面的「整理主線與人設」，它才有材料可以回答。'
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter 送出、Shift+Enter 換行——這是一個問句，不是一篇稿子。
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          className="w-full resize-y rounded-2xl bg-stage-950 px-4 py-3 text-[15px] leading-7 text-ink-50 ring-1 ring-stage-700 outline-none transition-shadow placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500/60 disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={episodeId}
            disabled={!canRun || busy}
            onChange={(event) => setEpisodeId(event.target.value)}
            className="rounded-full bg-stage-850 px-3 py-1.5 text-[13px] text-ink-300 ring-1 ring-stage-700 outline-none disabled:opacity-50"
          >
            <option value="">不指定集數</option>
            {episodes.map((episode) => (
              <option key={episode.episodeId} value={episode.episodeId}>
                第 {episode.number} 集{episode.title ? `《${episode.title}》` : ''}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-600">
            {episodeId ? '會把那一集全文一起給它' : '只用上面整理好的內容'}
          </span>

          <div className="ml-auto">
            <BigButton
              primary
              busy={busy}
              disabled={!canRun || !draft.trim()}
              onClick={submit}
              icon={<Send className="size-4" />}
              title={canRun ? undefined : '你的角色不能跑 AI 任務'}
            >
              {busy ? '想一下…' : '問'}
            </BigButton>
          </div>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 暖寶 CEO 的十四條審核準則，與這個助手會做的十二件事。
 *
 * 原稿是老闆那份 HTML 裡寫死的兩個陣列（`docs/needs/`），一個字沒改。勾掉的那
 * 幾條會真的從提示詞裡消失——`auditPersona(enabled)` 讀的是同一份清單，所以畫
 * 面與提示詞不可能講不同的話。
 */
function RulesPanel({
  enabled,
  onToggle,
}: {
  enabled: number[]
  onToggle: (index: number) => void
}) {
  return (
    <details className="group panel rounded-2xl bg-stage-900 ring-1 ring-stage-700">
      <summary className="tap flex cursor-pointer list-none items-center gap-2.5 px-5 py-4 text-sm text-ink-300 transition-colors hover:text-ink-100">
        <span aria-hidden className="text-ink-600 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className="font-medium">審核準則</span>
        <span className="rounded-full bg-stage-850 px-2 py-0.5 text-xs text-ink-500 tabular-nums">
          {enabled.length} / {AUDIT_RULES.length}
        </span>
      </summary>

      <div className="flex flex-col gap-5 border-t border-stage-700/60 p-5">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {AUDIT_RULES.map((rule, index) => {
            const on = enabled.includes(index)
            return (
              <li key={rule}>
                <label
                  className={cn(
                    'tap flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
                    on ? 'bg-stage-850/70 hover:bg-stage-800' : 'opacity-50 hover:opacity-80'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(index)}
                    className="mt-1 size-4 shrink-0 accent-accent-500"
                  />
                  <span className="text-sm leading-6 text-ink-200">{rule}</span>
                </label>
              </li>
            )
          })}
        </ul>

        <p className="text-xs leading-relaxed text-ink-600">
          勾掉的那幾條會真的從提示詞裡拿掉。這個選擇記在這台裝置上，換一台要重勾。
        </p>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-ink-300">它會做的十二件事</h4>
          <ul className="flex flex-wrap gap-2">
            {AUDIT_SKILLS.map((skill, index) => (
              <li
                key={skill}
                className="rounded-full bg-stage-850 px-3 py-1 text-[13px] text-ink-400 ring-1 ring-stage-700"
              >
                {index + 1}. {skill}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  )
}

/* -------------------------------------------------------------------------- */

/** 今天幾號幾點，給存起來的那一份當標題用。 */
function stamp(): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * 存進資料庫。
 *
 * 跟旁邊那兩顆「存成 JSON／文件」不一樣：那兩顆是下載到自己電腦，這一顆是存進
 * 作品裡，兩個人都看得到、而且隨時點得開。按過之後變成一個勾——不擋你再按一
 * 次（重跑一次通常正是因為上一次不夠好，而兩份並排比較是這東西的用途之一）。
 */
function SaveButton({ onSave }: { onSave: () => Promise<void> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      await onSave()
      setDone(true)
    } catch (cause) {
      toast.error('存不起來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title="存進這個作品，之後隨時點得開"
      className={cn(
        'tap inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] ring-1 transition-all',
        done
          ? 'bg-emerald-950/40 text-emerald-300 ring-emerald-800/60'
          : 'bg-stage-850 text-ink-300 ring-stage-700 hover:-translate-y-0.5 hover:text-ink-50',
        busy && 'opacity-60'
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : done ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Archive aria-hidden className="size-3.5" />
      )}
      {done ? '已存' : '存起來'}
    </button>
  )
}

/**
 * 存起來的那些（Z200）。
 *
 * 每一份收起來，點箭頭展開。最新的在最上面——找的多半是「剛才那一份」，不是三
 * 週前那一份。
 */
function SavedPanel({
  projectId,
  saved,
  canRun,
}: {
  projectId: string
  saved: SavedReport[]
  canRun: boolean
}) {
  if (saved.length === 0) return null

  return (
    <section className="panel flex flex-col gap-3 rounded-2xl bg-stage-900 p-5 ring-1 ring-stage-700 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300"
        >
          <Archive className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-base font-semibold text-ink-50">存起來的</h2>
          <p className="text-[13px] text-ink-500">
            共 {saved.length} 份，點箭頭展開。兩個人都看得到。
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {saved.map((report) => (
          <li key={report.id}>
            <SavedItem projectId={projectId} report={report} canRun={canRun} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function SavedItem({
  projectId,
  report,
  canRun,
}: {
  projectId: string
  report: SavedReport
  canRun: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [removing, setRemoving] = useState(false)
  const [asking, setAsking] = useState(false)

  const digest = asStoryDigest(report)
  const audit = asEpisodeAudit(report)
  const turns = asTurns(report)
  const verdicts = asVerdicts(report)

  async function remove() {
    if (removing) return
    setRemoving(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/audit/reports/${report.id}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success('刪掉了', report.title)
      router.refresh()
    } catch (cause) {
      toast.error('刪不掉', cause instanceof Error ? cause.message : undefined)
    } finally {
      setRemoving(false)
      setAsking(false)
    }
  }

  return (
    <details className="group rounded-2xl bg-stage-850/60 ring-1 ring-stage-700/60 transition-all open:bg-stage-850 open:ring-stage-700">
      <summary className="tap flex cursor-pointer list-none items-center gap-2.5 px-4 py-3">
        {/* 下拉／收合的那支箭頭。 */}
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-ink-600 transition-transform group-open:rotate-90"
        />
        <span className="shrink-0 rounded-full bg-stage-800 px-2 py-0.5 text-[11px] text-ink-400">
          {REPORT_KIND_LABEL[report.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-100">{report.title}</span>
        <span className="hidden shrink-0 text-xs text-ink-600 sm:inline">
          {report.createdByName}
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-stage-700/60 p-4">
        {digest && <DigestView digest={digest} />}

        {audit && <AuditView audit={audit} />}

        {verdicts.length > 0 && (
          <ul className="flex flex-col gap-3">
            {verdicts.map((verdict) => (
              <li key={verdict.question}>
                {/* 存起來的判定沒有原本那一條疑點的引文，所以用判定自己的問句。 */}
                <DoubtView
                  doubt={{ question: verdict.question, quote: '', why: '' }}
                  verdict={verdict}
                />
              </li>
            ))}
          </ul>
        )}

        {turns.length > 0 && (
          <ul className="flex flex-col gap-5">
            {turns.map((turn, index) => (
              <li key={`${index}-${turn.question}`} className="flex flex-col gap-3">
                <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-600/25 px-4 py-2.5 text-[15px] leading-7 text-ink-50 ring-1 ring-accent-500/30">
                  {turn.question}
                </p>
                <div className="rounded-2xl rounded-tl-md bg-stage-900/70 px-4 py-3 ring-1 ring-stage-700/60">
                  <RichText text={turn.answer} size="lg" />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-stage-700/40 pt-3">
          <span className="text-xs text-ink-600">
            {new Date(report.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
            {report.model ? `・${report.model}` : ''}
          </span>

          {canRun && (
            <span className="ml-auto">
              {asking ? (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className="text-ink-500">刪掉這一份？</span>
                  <button
                    type="button"
                    disabled={removing}
                    onClick={remove}
                    className="tap rounded px-2 py-0.5 text-rose-300 ring-1 ring-rose-800 transition-colors hover:bg-rose-950 disabled:opacity-50"
                  >
                    刪掉
                  </button>
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => setAsking(false)}
                    className="tap rounded px-2 py-0.5 text-ink-500 transition-colors hover:text-ink-300"
                  >
                    算了
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAsking(true)}
                  className="tap inline-flex items-center gap-1 text-xs text-ink-600 transition-colors hover:text-rose-300"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  刪掉
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </details>
  )
}

/* -------------------------------------------------------------------------- */

/** 把畫面上現在有的東西存成檔案。 */
function download(name: string, content: string, type: string) {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(new Blob([content], { type }))
  anchor.download = name
  anchor.click()
  // 不收回去的話這個 blob 會活到關掉分頁為止。
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
}

/**
 * 把畫面上整理好的東西壓成一段文字，當問答的材料。
 *
 * 壓得很緊：這一段每一次提問都會被送一次，而它的長度直接乘上問答的次數。爽點
 * 與鉤子留原文（問題多半就是衝著那兩樣來的），事件只留標題。
 */
function materialFor(
  digest: StoryDigest | null,
  episodes: WriterEpisode[],
  states: Record<string, EpisodeState>
): string {
  const parts: string[] = []

  if (digest) {
    parts.push(`主線：${digest.mainline}`)
    if (digest.threads.length > 0) {
      parts.push(`支線：\n${digest.threads.map((t) => `- ${t}`).join('\n')}`)
    }
    if (digest.characters.length > 0) {
      parts.push(
        `人物：\n${digest.characters
          .map((c) => `- ${c.name}：現在 ${c.now}／想要 ${c.wants}／變化 ${c.changed}`)
          .join('\n')}`
      )
    }
  }

  for (const episode of episodes) {
    const audit = states[episode.episodeId]?.audit
    if (!audit) continue
    const bits = [`第 ${episode.number} 集${episode.title ? `《${episode.title}》` : ''}`]
    bits.push(
      `　爽點：${audit.payoff.present ? audit.payoff.what : '沒有'}${audit.payoff.quote ? `（原文：${audit.payoff.quote}）` : ''}`
    )
    bits.push(
      `　鉤子：${audit.hook.present ? audit.hook.what : '沒有'}${audit.hook.quote ? `（原文：${audit.hook.quote}）` : ''}`
    )
    if (audit.doubts.length > 0) {
      bits.push(`　疑點：${audit.doubts.map((d) => d.question).join('；')}`)
    }
    parts.push(bits.join('\n'))
  }

  return parts.join('\n\n')
}

function toMarkdown(
  projectTitle: string,
  digest: StoryDigest | null,
  episodes: WriterEpisode[],
  states: Record<string, EpisodeState>,
  enabled: number[],
  turns: AskTurn[]
): string {
  const out: string[] = [`# ${projectTitle}｜編劇審核`, '']

  if (digest) {
    out.push('## 目前的主線', '', digest.mainline, '')
    if (digest.threads.length > 0) {
      out.push('### 支線', '', ...digest.threads.map((t) => `- ${t}`), '')
    }
    if (digest.characters.length > 0) {
      out.push('### 人設現況', '')
      for (const person of digest.characters) {
        out.push(`**${person.name}**`, '')
        if (person.now) out.push(`- 現在：${person.now}`)
        if (person.wants) out.push(`- 想要：${person.wants}`)
        if (person.changed) out.push(`- 變化：${person.changed}`)
        out.push('')
      }
    }
    if (digest.issues.length > 0) {
      out.push('### 跨集的問題', '')
      for (const issue of digest.issues) {
        out.push(`- ${issue.question}`)
        if (issue.why) out.push(`  - 為什麼：${issue.why}`)
        if (issue.quote) out.push(`  - 依據：${issue.quote}`)
      }
      out.push('')
    }
  }

  for (const episode of episodes) {
    const audit = states[episode.episodeId]?.audit
    if (!audit) continue
    out.push(`## 第 ${episode.number} 集${episode.title ? `《${episode.title}》` : ''}`, '')
    out.push(
      `- **爽點**：${audit.payoff.present ? audit.payoff.what : `沒有——${audit.payoff.what}`}`
    )
    if (audit.payoff.where) out.push(`  - 在哪裡：${audit.payoff.where}`)
    if (audit.payoff.quote) out.push(`  - 原文：${audit.payoff.quote}`)
    out.push(`- **鉤子**：${audit.hook.present ? audit.hook.what : `沒有——${audit.hook.what}`}`)
    if (audit.hook.quote) out.push(`  - 原文：${audit.hook.quote}`)
    out.push('')
    if (audit.events.length > 0) {
      out.push('### 本集事件', '', ...audit.events.map((e, i) => `${i + 1}. ${e}`), '')
    }
    if (audit.details.length > 0) {
      out.push('### 細節', '')
      for (const note of audit.details) {
        out.push(`- ${note.issue}`)
        if (note.quote) out.push(`  - 原文：${note.quote}`)
      }
      out.push('')
    }
    if (audit.doubts.length > 0) {
      out.push('### 讀到這裡會卡住的地方', '')
      for (const doubt of audit.doubts) {
        out.push(`- ${doubt.question}`)
        if (doubt.why) out.push(`  - 為什麼：${doubt.why}`)
        if (doubt.quote) out.push(`  - 原文：${doubt.quote}`)
      }
      out.push('')
    }
  }

  if (turns.length > 0) {
    out.push('## 問答', '')
    for (const turn of turns) {
      out.push(`**Q：${turn.question}**`, '', turn.answer, '')
    }
  }

  out.push('---', '', '### 採用的審核準則', '')
  out.push(...AUDIT_RULES.filter((_, i) => enabled.includes(i)).map((rule) => `- ${rule}`))
  return out.join('\n')
}
