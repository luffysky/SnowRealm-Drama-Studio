'use client'

import { Loader2, MessageSquare, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { AUDIT_RULES, AUDIT_SKILLS } from '@/lib/ai/audit-rules'
import type { AskTurn } from '@/lib/ai/story-audit-view'
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
  projectTitle,
  episodes,
  canRun,
}: {
  projectId: string
  projectTitle: string
  episodes: WriterEpisode[]
  canRun: boolean
}) {
  const toast = useToast()
  const [digest, setDigest] = useState<StoryDigest | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)
  const [states, setStates] = useState<Record<string, EpisodeState>>({})
  const [runningAll, setRunningAll] = useState(false)
  const [turns, setTurns] = useState<AskTurn[]>([])

  /*
   * 勾掉的準則要真的從提示詞裡消失。
   *
   * 存在 localStorage：這是一個偏好，不是資料。存進資料庫要一支遷移，而為了
   * 十四個核取方塊的勾選狀態去改 schema 不划算——代價是它跟著這台裝置走，而
   * 畫面上有寫。
   */
  const [enabled, setEnabled] = useState<number[]>(() => AUDIT_RULES.map((_, i) => i))
  useEffect(() => {
    /*
     * 推到下一個 tick，因為 `localStorage` 在伺服器端渲染時不存在——不能當惰性
     * 初始值，不然會水合不一致。
     *
     * **沒有 `restored.current` 那種守衛。** `FloatingChat` 有，而它在
     * StrictMode 下會把自己鎖死：第一次掛載設旗標並排 timer，cleanup 取消
     * timer，第二次掛載被旗標擋下來，於是那個 setState 永遠不會跑（Z196）。
     * 這裡多讀一次 localStorage 沒有任何代價。
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

  /**
   * 問它一個問題。
   *
   * 材料是**已經算好的那一份**——主線整理加逐集的爽點鉤子，不是十萬字正文。那
   * 份整理就是為了這個才先算的；指定某一集的時候才額外附上那一集全文，因為
   * 「這一句寫得不好」這種問題非看原文不可。
   */
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

  const done = episodes.filter((e) => states[e.episodeId]?.status === 'done').length

  /** 畫面上現在有什麼就匯出什麼——不會為了匯出再跑一次，那是另一筆錢。 */
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

  const hasSomething = Boolean(digest) || done > 0 || turns.length > 0

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

      <AskPanel
        episodes={episodes}
        turns={turns}
        canRun={canRun}
        onAsk={ask}
        ready={Boolean(digest) || done > 0}
      />

      {hasSomething && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => download(`${projectTitle}-編劇審核.json`, JSON.stringify(report(), null, 2), 'application/json')}
            className="tap rounded-lg bg-stage-850 px-2.5 py-1 text-[11px] text-ink-400 ring-1 ring-stage-700 transition-colors hover:text-ink-100"
          >
            匯出 JSON
          </button>
          <button
            type="button"
            onClick={() => download(`${projectTitle}-編劇審核.md`, toMarkdown(projectTitle, digest, episodes, states, enabled, turns), 'text/markdown;charset=utf-8')}
            className="tap rounded-lg bg-stage-850 px-2.5 py-1 text-[11px] text-ink-400 ring-1 ring-stage-700 transition-colors hover:text-ink-100"
          >
            匯出 Markdown
          </button>
          <span className="text-[10px] text-ink-700">匯出畫面上現在有的，不會再跑一次</span>
        </div>
      )}

      {digest && <DigestView digest={digest} />}

      <RulesPanel enabled={enabled} onToggle={toggleRule} />

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

const RULES_KEY = 'srds:writer-rules'

/**
 * 問它問題。
 *
 * 報告是唯讀的，而讀完一定會有問題——「第 7 集這個爽點我覺得不夠」「馬大後來
 * 怎麼不見了」。沒有地方問的話，這一頁就只是一份印出來的紙。
 *
 * **問答留在報告裡**，匯出的時候一起帶走：問過的問題跟結論本來就是這份審核的
 * 一部分。代價是重新整理頁面就沒了——要留下來得開一張表，那是下一步。
 */
function AskPanel({
  episodes,
  turns,
  canRun,
  ready,
  onAsk,
}: {
  episodes: WriterEpisode[]
  turns: AskTurn[]
  canRun: boolean
  /** 還沒整理過的時候它手上沒有材料，問了也只能憑空答。 */
  ready: boolean
  onAsk: (question: string, episodeId: string | null) => Promise<void>
}) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [episodeId, setEpisodeId] = useState('')
  const [busy, setBusy] = useState(false)

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
    <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-100">
          <MessageSquare aria-hidden className="size-4 text-accent-400" />
          問它
        </h2>
        <p className="text-xs text-ink-500">
          它手上有上面整理好的東西，可以直接問。
        </p>
      </div>

      {turns.length > 0 && (
        <ul className="flex flex-col gap-3">
          {turns.map((turn, index) => (
            <li key={`${index}-${turn.question}`} className="flex flex-col gap-1.5">
              <p className="rounded-lg bg-stage-850 px-3 py-2 text-[13px] leading-relaxed text-ink-200">
                {turn.question}
              </p>
              <p className="px-1 text-sm leading-7 whitespace-pre-wrap text-ink-100">
                {turn.answer}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
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
          className="w-full resize-y rounded-lg bg-stage-950 px-3 py-2 text-sm leading-relaxed text-ink-50 ring-1 ring-stage-700 outline-none placeholder:text-ink-600 focus:ring-accent-500/60 disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={episodeId}
            disabled={!canRun || busy}
            onChange={(event) => setEpisodeId(event.target.value)}
            className="rounded-lg bg-stage-850 px-2 py-1 text-xs text-ink-300 ring-1 ring-stage-700 outline-none disabled:opacity-50"
          >
            <option value="">不指定集數</option>
            {episodes.map((episode) => (
              <option key={episode.episodeId} value={episode.episodeId}>
                第 {episode.number} 集{episode.title ? `《${episode.title}》` : ''}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-ink-600">
            {episodeId ? '會附上那一集全文' : '只用上面整理好的內容'}
          </span>

          <Button
            size="sm"
            className="ml-auto"
            onClick={submit}
            loading={busy}
            disabled={!canRun || busy || !draft.trim()}
            title={canRun ? undefined : '你的角色不能跑 AI 任務'}
          >
            問
          </Button>
        </div>
      </div>
    </section>
  )
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
    if (digest.threads.length > 0) parts.push(`支線：\n${digest.threads.map((t) => `- ${t}`).join('\n')}`)
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
    bits.push(`　爽點：${audit.payoff.present ? audit.payoff.what : '沒有'}${audit.payoff.quote ? `（原文：${audit.payoff.quote}）` : ''}`)
    bits.push(`　鉤子：${audit.hook.present ? audit.hook.what : '沒有'}${audit.hook.quote ? `（原文：${audit.hook.quote}）` : ''}`)
    if (audit.doubts.length > 0) {
      bits.push(`　疑點：${audit.doubts.map((d) => d.question).join('；')}`)
    }
    parts.push(bits.join('\n'))
  }

  return parts.join('\n\n')
}

/* -------------------------------------------------------------------------- */

/**
 * 暖寶 CEO 的十四條審核準則，與這個助手會做的十二件事。
 *
 * 原稿是老闆那份 HTML 裡寫死的兩個陣列（`docs/needs/`），一個字沒改。勾掉的
 * 那幾條會真的從提示詞裡消失——`auditPersona(enabled)` 是同一份清單算出來的，
 * 所以畫面與提示詞不可能講不同的話。
 */
function RulesPanel({
  enabled,
  onToggle,
}: {
  enabled: number[]
  onToggle: (index: number) => void
}) {
  return (
    <details className="group panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
      <summary className="tap flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[11px] text-ink-300 transition-colors hover:text-ink-100">
        <span aria-hidden className="text-ink-600 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className="font-medium">審核準則</span>
        <span className="text-[10px] text-ink-600">
          {enabled.length} / {AUDIT_RULES.length} 條在用
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-stage-700/60 p-4">
        <ul className="grid gap-1 sm:grid-cols-2">
          {AUDIT_RULES.map((rule, index) => (
            <li key={rule}>
              <label className="tap flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-stage-850">
                <input
                  type="checkbox"
                  checked={enabled.includes(index)}
                  onChange={() => onToggle(index)}
                  className="mt-0.5 size-3.5 shrink-0 accent-accent-500"
                />
                <span className="text-xs leading-relaxed text-ink-300">{rule}</span>
              </label>
            </li>
          ))}
        </ul>

        <p className="text-[10px] leading-relaxed text-ink-600">
          勾掉的那幾條會真的從提示詞裡拿掉。這個選擇記在這台裝置上，換一台要重勾。
        </p>

        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-ink-400">它會做的十二件事</h4>
          <ul className="flex flex-wrap gap-1.5">
            {AUDIT_SKILLS.map((skill, index) => (
              <li
                key={skill}
                className="rounded-full bg-stage-850 px-2 py-0.5 text-[10px] text-ink-500 ring-1 ring-stage-700"
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

/** 把畫面上現在有的東西存成檔案。 */
function download(name: string, content: string, type: string) {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(new Blob([content], { type }))
  anchor.download = name
  anchor.click()
  // 不收回去的話這個 blob 會活到關掉分頁為止。
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
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
      `- **爽點**：${audit.payoff.present ? audit.payoff.what : '沒有——' + audit.payoff.what}`
    )
    if (audit.payoff.where) out.push(`  - 在哪裡：${audit.payoff.where}`)
    if (audit.payoff.quote) out.push(`  - 原文：${audit.payoff.quote}`)
    out.push(`- **鉤子**：${audit.hook.present ? audit.hook.what : '沒有——' + audit.hook.what}`)
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

/* -------------------------------------------------------------------------- */

function DigestView({ digest }: { digest: StoryDigest }) {
  return (
    <section className="panel flex flex-col gap-4 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-medium text-ink-300">目前的主線</h3>
        <p className="text-[15px] leading-7 whitespace-pre-wrap text-ink-100">
          {digest.mainline}
        </p>
      </div>

      {digest.threads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-medium text-ink-300">支線</h3>
          <ul className="flex flex-col gap-1">
            {digest.threads.map((thread) => (
              <li key={thread} className="flex gap-2 text-sm leading-relaxed text-ink-300">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent-500/70" />
                {thread}
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.characters.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink-300">人設現況</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {digest.characters.map((person) => (
              <div
                key={person.name}
                className="flex flex-col gap-1 rounded-lg bg-stage-850 p-3 ring-1 ring-stage-700/60"
              >
                <span className="text-sm font-medium text-ink-50">{person.name}</span>
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
          <h3 className="text-[13px] font-medium text-ink-300">跨集的問題</h3>
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
    <p className="flex gap-2 text-[13px] leading-relaxed">
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
        <span className="text-sm font-medium text-ink-100">
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
        <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-900/60">
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
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-300">
            {audit.events.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ol>
        </details>
      )}

      {audit.details.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[13px] font-medium text-amber-300/90">細節</h4>
          <ul className="flex flex-col gap-1.5">
            {audit.details.map((note) => (
              <li key={note.issue} className="flex flex-col gap-0.5">
                <span className="text-sm leading-relaxed text-ink-200">{note.issue}</span>
                {note.quote && <Quote text={note.quote} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {audit.doubts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[13px] font-medium text-ink-300">讀到這裡會卡住的地方</h4>
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
        <span className="text-[13px] font-medium text-ink-200">{label}</span>
        {!beat.present && <span className="text-[10px] text-amber-300/90">沒有</span>}
        {beat.where && <span className="ml-auto text-[10px] text-ink-600">{beat.where}</span>}
      </div>
      <p className="text-sm leading-relaxed text-ink-200">{beat.what || '——'}</p>
      {beat.quote && <Quote text={beat.quote} />}
    </div>
  )
}

function DoubtView({ doubt }: { doubt: AuditDoubt }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm leading-relaxed text-ink-200">{doubt.question}</span>
      {doubt.why && <span className="text-xs leading-relaxed text-ink-500">{doubt.why}</span>}
      {doubt.quote && <Quote text={doubt.quote} />}
    </div>
  )
}

/** 原文引文。沒有引文的判斷在這份報告裡沒有用，所以它要看得出來是原文。 */
function Quote({ text }: { text: string }) {
  return (
    <p className="border-l-2 border-stage-600 py-0.5 pl-2.5 text-xs leading-relaxed text-ink-400">
      {text}
    </p>
  )
}
