'use client'

import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  AUDIT_QUESTIONS,
  type AuditBeat,
  type AuditDoubt,
  type EpisodeAudit,
  type StoryDigest,
} from '@/lib/ai/story-audit-view'
import { cn } from '@/lib/utils'

/**
 * 編劇助手（Z198）。
 *
 * 暖寶要的是「**整理給我看**」，所以這一頁沒有一個要貼內容的輸入框——材料全部
 * 由伺服器端自己從資料庫湊齊。畫面上只有一顆按鈕跟一份報告。
 *
 * ## 一集一支請求
 *
 * 二十集一次跑完要五到十分鐘，而函式有執行時間上限。所以這裡一集一集叫，跑完
 * 一集就把那一集畫出來——她可以邊跑邊看，而不是盯著一個轉圈圈等十分鐘。
 *
 * 中途失敗的那一集留在原地標紅，不中斷其餘的：二十集裡有一集讀不出來，不是把
 * 另外十九集也丟掉的理由。
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
}

export function WriterAssistant({
  projectId,
  episodes,
  canRun,
}: {
  projectId: string
  episodes: WriterEpisode[]
  canRun: boolean
}) {
  const toast = useToast()
  const [digest, setDigest] = useState<StoryDigest | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)
  const [states, setStates] = useState<Record<string, EpisodeState>>({})
  const [runningAll, setRunningAll] = useState(false)

  const setOne = (episodeId: string, next: EpisodeState) =>
    setStates((current) => ({ ...current, [episodeId]: next }))

  async function runDigest() {
    if (digestBusy) return
    setDigestBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
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
        body: JSON.stringify({ episodeId: episode.episodeId }),
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

  async function runAll() {
    if (runningAll) return
    setRunningAll(true)
    let failed = 0
    for (const episode of episodes) {
      // 一集一支請求，照順序跑。跑完一集畫面就多一塊。
      const ok = await runEpisode(episode)
      if (!ok) failed += 1
    }
    setRunningAll(false)
    if (failed > 0) toast.error(`有 ${failed} 集沒整理出來`, '其餘的已經在下面了。')
  }

  const done = episodes.filter((e) => states[e.episodeId]?.status === 'done').length

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-100">
            <Sparkles aria-hidden className="size-4 text-accent-400" />
            整理給我看
          </h2>
          <p className="text-[11px] text-ink-500">
            材料直接從這部作品裡讀，不用貼。目前有 {episodes.length} 集有正文。
          </p>
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
          {AUDIT_QUESTIONS.map((question) => (
            <li key={question} className="inline-flex items-center gap-1">
              <span aria-hidden className="text-accent-500/70">
                ·
              </span>
              {question}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={runDigest}
            loading={digestBusy}
            disabled={!canRun || digestBusy}
            title={canRun ? undefined : '你的角色不能跑 AI 任務'}
          >
            整理主線與人設
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={runAll}
            loading={runningAll}
            disabled={!canRun || runningAll || episodes.length === 0}
            title={canRun ? undefined : '你的角色不能跑 AI 任務'}
          >
            逐集看爽點與鉤子（{episodes.length} 集）
          </Button>
          {done > 0 && (
            <span className="text-[11px] text-ink-600 tabular-nums">已整理 {done} 集</span>
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-ink-600">
          一集一支請求，跑完一集就出現一塊，可以邊跑邊看。這會花錢（算在成本中心的 AI
          那一欄），而且每次重跑都是一次新的花費。
        </p>
      </section>

      {digest && <DigestView digest={digest} />}

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
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function DigestView({ digest }: { digest: StoryDigest }) {
  return (
    <section className="panel flex flex-col gap-4 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-ink-300">目前的主線</h3>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-100">
          {digest.mainline}
        </p>
      </div>

      {digest.threads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-300">支線</h3>
          <ul className="flex flex-col gap-1">
            {digest.threads.map((thread) => (
              <li key={thread} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent-500/70" />
                {thread}
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.characters.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-ink-300">人設現況</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {digest.characters.map((person) => (
              <div
                key={person.name}
                className="flex flex-col gap-1 rounded-lg bg-stage-850 p-3 ring-1 ring-stage-700/60"
              >
                <span className="text-xs font-medium text-ink-50">{person.name}</span>
                {person.now && <Line label="現在" value={person.now} />}
                {person.wants && <Line label="想要" value={person.wants} />}
                {person.changed && <Line label="變化" value={person.changed} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {digest.issues.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-300">跨集的問題</h3>
          <ul className="flex flex-col gap-2">
            {digest.issues.map((issue) => (
              <li key={issue.question}>
                <DoubtView doubt={issue} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-1.5 text-[11px] leading-relaxed">
      <span className="shrink-0 text-ink-600">{label}</span>
      <span className="min-w-0 text-ink-300">{value}</span>
    </p>
  )
}

function EpisodeCard({
  episode,
  state,
  canRun,
  onRun,
}: {
  episode: WriterEpisode
  state: EpisodeState | undefined
  canRun: boolean
  onRun: () => void
}) {
  const status = state?.status ?? 'idle'

  return (
    <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-100">
          第 {episode.number} 集{episode.title ? `《${episode.title}》` : ''}
        </span>
        <span className="text-[10px] text-ink-600 tabular-nums">
          {episode.chars.toLocaleString('en-US')} 字
        </span>

        <span className="ml-auto">
          {status === 'running' ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
              <Loader2 aria-hidden className="size-3 animate-spin" />
              整理中
            </span>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              title={canRun ? undefined : '你的角色不能跑 AI 任務'}
              className="tap text-[11px] text-ink-500 transition-colors hover:text-ink-200 disabled:opacity-50"
            >
              {status === 'idle' ? '整理這一集' : '重新整理'}
            </button>
          )}
        </span>
      </header>

      {status === 'failed' && (
        <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300 ring-1 ring-rose-900/60">
          {state?.error ?? '讀不出來'}
        </p>
      )}

      {state?.audit && <AuditView audit={state.audit} />}
    </section>
  )
}

function AuditView({ audit }: { audit: EpisodeAudit }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 lg:grid-cols-2">
        <BeatView label="爽點" beat={audit.payoff} tone="payoff" />
        <BeatView label="鉤子" beat={audit.hook} tone="hook" />
      </div>

      {audit.events.length > 0 && (
        <details className="group">
          <summary className="tap cursor-pointer list-none text-[11px] text-ink-600 transition-colors hover:text-ink-300">
            <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">
              ›
            </span>
            本集事件（{audit.events.length}）
          </summary>
          <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-5 text-[11px] leading-relaxed text-ink-400">
            {audit.events.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ol>
        </details>
      )}

      {audit.details.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-amber-300/90">細節</h4>
          <ul className="flex flex-col gap-1.5">
            {audit.details.map((note) => (
              <li key={note.issue} className="flex flex-col gap-0.5">
                <span className="text-[11px] leading-relaxed text-ink-200">{note.issue}</span>
                {note.quote && <Quote text={note.quote} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {audit.doubts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-ink-300">讀到這裡會卡住的地方</h4>
          <ul className="flex flex-col gap-2">
            {audit.doubts.map((doubt) => (
              <li key={doubt.question}>
                <DoubtView doubt={doubt} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function BeatView({
  label,
  beat,
  tone,
}: {
  label: string
  beat: AuditBeat
  tone: 'payoff' | 'hook'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg p-3 ring-1',
        beat.present
          ? tone === 'payoff'
            ? 'bg-emerald-950/30 ring-emerald-900/50'
            : 'bg-accent-950/30 ring-accent-800/50'
          : 'bg-stage-850 ring-stage-700/60'
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-medium text-ink-200">{label}</span>
        {!beat.present && <span className="text-[10px] text-amber-300/90">沒有</span>}
        {beat.where && <span className="ml-auto text-[10px] text-ink-600">{beat.where}</span>}
      </div>
      <p className="text-[11px] leading-relaxed text-ink-300">{beat.what || '——'}</p>
      {beat.quote && <Quote text={beat.quote} />}
    </div>
  )
}

function DoubtView({ doubt }: { doubt: AuditDoubt }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] leading-relaxed text-ink-200">{doubt.question}</span>
      {doubt.why && <span className="text-[10px] leading-relaxed text-ink-600">{doubt.why}</span>}
      {doubt.quote && <Quote text={doubt.quote} />}
    </div>
  )
}

/** 原文引文。沒有引文的判斷在這份報告裡沒有用，所以它要看得出來是原文。 */
function Quote({ text }: { text: string }) {
  return (
    <p className="border-l-2 border-stage-600 pl-2 text-[10px] leading-relaxed text-ink-500">
      {text}
    </p>
  )
}
