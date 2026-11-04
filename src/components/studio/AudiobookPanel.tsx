'use client'

import { Download, Headphones, Loader2, Pause, Play, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { useOptionalPlayer } from '@/components/studio/PlayerProvider'
import { assetDownloadUrl } from '@/lib/asset-url'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn, formatDurationZh } from '@/lib/utils'
import type { BookEpisode } from '@/components/studio/BookTabs'

/**
 * 有聲 (Z129 / Z136).
 *
 * 一集一列：已經做好的可以播、可以下載；還沒做的先試算再產生。
 *
 * 試算是免費的，而且**一定先算給你看**——合成是這個 app 裡少數幾個一按就會
 * 花錢的動作，所以長度跟價錢要在按下去之前就在畫面上。
 *
 * 合成分好幾次做完（一集約三十分鐘音檔 vs 60 秒函式上限），所以這裡會盯著
 * 進度。`keepalive` 讓那個催促請求在換頁之後仍然送達——Z126 就是栽在這一點。
 */

type Plan = {
  parts: number
  billableChars: number
  estimatedSec: number
  estimatedCostUsd: number | null
  cast: { name: string; voiceId: string | null }[]
  /** How many lines already know who said them (Z132). */
  attributedLines: number
}

type Progress = {
  jobId: string
  status: string
  done: number
  total: number
  percent: number
  assetId: string | null
  note: string
}

const LIVE = new Set(['QUEUED', 'RUNNING', 'AWAITING_PROVIDER'])

export function AudiobookPanel({
  projectId,
  episodes,
  canGenerate,
}: {
  projectId: string
  episodes: BookEpisode[]
  canGenerate: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const player = useOptionalPlayer()

  const [open, setOpen] = useState<string | null>(null)
  const [plans, setPlans] = useState<Record<string, Plan | null>>({})
  const [progress, setProgress] = useState<Record<string, Progress | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [speech, setSpeech] = useState<{ available: boolean; detail: string } | null>(null)

  const written = episodes.filter((episode) => episode.charCount > 0)

  /** Loads the estimate for one episode. Costs nothing and charges nothing. */
  const loadPlan = useCallback(
    async (episodeId: string) => {
      setBusy(episodeId)
      try {
        const response = await apiFetch(
          `/api/projects/${projectId}/episodes/${episodeId}/audiobook?plan=1`
        )
        if (!response.ok) throw new Error(await readApiError(response))

        const body = (await response.json()) as {
          plan?: Plan
          progress?: Progress | null
          speech?: { available: boolean; detail: string }
        }

        setPlans((previous) => ({ ...previous, [episodeId]: body.plan ?? null }))
        setProgress((previous) => ({ ...previous, [episodeId]: body.progress ?? null }))
        if (body.speech) setSpeech(body.speech)
      } catch (cause) {
        toast.error('試算失敗', cause instanceof Error ? cause.message : undefined)
      } finally {
        setBusy(null)
      }
    },
    [projectId, toast]
  )

  /**
   * 讓模型讀一遍，判斷每句對白是誰說的 (Z132).
   *
   * 分開做而不是合成時順便，因為它是**另一種花費**，而且它的答案是會被重複
   * 使用的：判斷一次，之後換音色重做都不用再問。合成則是每次都要重跑。
   */
  async function attribute(episodeId: string) {
    setBusy(episodeId)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/attribution`,
        { method: 'POST' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { asked: number; settled: number }
      toast.success(
        `排入判斷 ${body.asked} 句`,
        body.settled > 0
          ? `另外 ${body.settled} 句規則就判得出來，沒有送去問。`
          : '判斷完要到 AI 製片中心的「待確認」採用，才會生效。'
      )
      void apiFetch('/api/ai/worker', { method: 'POST', keepalive: true }).catch(() => {})
    } catch (cause) {
      toast.error('排入失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function generate(episodeId: string) {
    setBusy(episodeId)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/audiobook`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已排入合成', '會分成好幾段做完，進度就在下面。')

      /*
       * Nudge the worker straight away. The schedule on this plan runs once a
       * day, and the worker chains itself from there — but somebody standing
       * in front of the screen should not wait for tomorrow.
       */
      void apiFetch('/api/ai/worker', { method: 'POST', keepalive: true }).catch(() => {})

      await loadPlan(episodeId)
    } catch (cause) {
      toast.error('排入失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  /*
   * Polls only while something is actually rendering, and stops when it is
   * done. A page that polls forever keeps a laptop warm all night to tell you
   * the same thing.
   */
  const running = Object.entries(progress).filter(
    ([, value]) => value && LIVE.has(value.status)
  )

  useEffect(() => {
    if (running.length === 0) return

    const timer = window.setInterval(() => {
      for (const [episodeId] of running) void loadPlan(episodeId)
      router.refresh()
    }, 5000)

    return () => window.clearInterval(timer)
  }, [running.length, loadPlan, router, running])

  if (written.length === 0) {
    return (
      <p className="rounded-xl bg-stage-900 px-3 py-8 text-center text-[11px] text-ink-600 ring-1 ring-stage-700/60">
        還沒有寫好的集數可以合成。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {speech && !speech.available && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
          {speech.detail}
        </p>
      )}

      {/* JSX, not markdown — asterisks print as asterisks here. */}
      <p className="text-[10px] leading-relaxed text-ink-600">
        按「試算」會算出長度與費用，<strong className="text-ink-300">不會</strong>
        產生任何東西也不會扣錢。確認之後再產生。合成會分成好幾段做完，關掉頁面也會繼續跑。
      </p>

      <ul className="flex flex-col gap-1.5">
        {written.map((episode) => {
          const plan = plans[episode.episodeId]
          const state = progress[episode.episodeId]
          const isOpen = open === episode.episodeId
          const working = state ? LIVE.has(state.status) : false

          return (
            <li
              key={episode.episodeId}
              className="flex flex-col gap-2 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-ink-500 tabular-nums">
                  EP{String(episode.number).padStart(3, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">
                  {episode.title || '未命名'}
                </span>
                <span className="text-[10px] text-ink-600 tabular-nums">
                  {episode.charCount.toLocaleString('zh-TW')} 字
                </span>
              </div>

              {episode.audio ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] text-accent-300">
                    <Headphones aria-hidden className="size-3" />
                    {episode.audio.durationSec
                      ? formatDurationZh(episode.audio.durationSec)
                      : '已完成'}
                  </span>
                  <span className="text-[10px] text-ink-600 tabular-nums">
                    {(episode.audio.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>

                  {player && (
                    <button
                      type="button"
                      onClick={() => {
                        const assetId = episode.audio!.assetId
                        const playing = player.track?.assetId === assetId && player.playing
                        if (player.track?.assetId === assetId) {
                          player.toggle()
                          return
                        }
                        player.load([
                          {
                            assetId,
                            projectId,
                            projectTitle: '',
                            title: `EP${String(episode.number).padStart(3, '0')} 有聲書`,
                            name: '',
                            artist: '',
                            category: 'OTHER',
                            durationSec: episode.audio!.durationSec,
                            licenseStatus: 'APPROVED',
                          },
                        ])
                        player.playAt(0)
                        void playing
                      }}
                      className="tap inline-flex items-center gap-1 rounded-md bg-accent-600 px-2 py-1 text-[10px] text-white hover:bg-accent-500"
                    >
                      {player.track?.assetId === episode.audio.assetId && player.playing ? (
                        <Pause aria-hidden className="size-3" />
                      ) : (
                        <Play aria-hidden className="size-3" />
                      )}
                      播放
                    </button>
                  )}

                  <a
                    href={assetDownloadUrl(episode.audio.assetId)}
                    className="tap inline-flex items-center gap-1 rounded-md bg-stage-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-stage-700 hover:text-ink-100"
                  >
                    <Download aria-hidden className="size-3" />
                    下載
                  </a>
                </div>
              ) : working && state ? (
                <div className="flex flex-col gap-1">
                  <div className="h-1 overflow-hidden rounded-full bg-stage-800">
                    <div
                      aria-hidden
                      className="h-full rounded-full bg-accent-500 transition-[width]"
                      style={{ width: `${state.percent}%` }}
                    />
                  </div>
                  <p className="flex items-center gap-1.5 text-[10px] text-ink-500">
                    <Loader2 aria-hidden className="size-3 animate-spin" />
                    {state.note}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {plan === undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(episode.episodeId)
                        void loadPlan(episode.episodeId)
                      }}
                      disabled={busy === episode.episodeId}
                      className="tap inline-flex w-fit items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-200 hover:bg-stage-700 hover:text-ink-50 disabled:opacity-50"
                    >
                      {busy === episode.episodeId ? (
                        <Loader2 aria-hidden className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles aria-hidden className="size-3.5" />
                      )}
                      試算
                    </button>
                  ) : plan === null ? (
                    <p className="text-[10px] text-ink-600">這一集算不出內容。</p>
                  ) : (
                    <>
                      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-500 tabular-nums">
                        <span>約 {formatDurationZh(Math.round(plan.estimatedSec))}</span>
                        <span>{plan.parts} 段</span>
                        <span>{plan.billableChars.toLocaleString('zh-TW')} 計費字元</span>
                        {plan.estimatedCostUsd !== null && (
                          <span className="text-ink-300">
                            估 ${plan.estimatedCostUsd.toFixed(4)}
                          </span>
                        )}
                      </p>

                      {plan.cast.length > 0 ? (
                        <p className="text-[10px] leading-relaxed text-ink-500">
                          分出 {plan.cast.length} 個聲音：
                          {plan.cast
                            .map((member) => member.name)
                            .slice(0, 6)
                            .join('、')}
                          {plan.attributedLines > 0 && (
                            <span className="text-ink-700">
                              （{plan.attributedLines} 句已歸屬）
                            </span>
                          )}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5 rounded-lg bg-amber-500/10 p-2.5 ring-1 ring-amber-500/20">
                          <p className="text-[10px] leading-relaxed text-amber-200">
                            目前<strong>全部</strong>會用旁白的聲音唸——對白還不知道是誰說的。
                            先讓 AI 判斷一遍，再產生才會有不同聲音。
                          </p>
                          {canGenerate && (
                            <button
                              type="button"
                              onClick={() => void attribute(episode.episodeId)}
                              disabled={busy === episode.episodeId}
                              className="tap inline-flex w-fit items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-200 hover:bg-stage-700 hover:text-ink-50 disabled:opacity-50"
                            >
                              {busy === episode.episodeId ? (
                                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles aria-hidden className="size-3.5" />
                              )}
                              判斷誰在說話
                            </button>
                          )}
                        </div>
                      )}

                      {canGenerate && (
                        <button
                          type="button"
                          onClick={() => void generate(episode.episodeId)}
                          disabled={busy === episode.episodeId}
                          className={cn(
                            'bg-brand-gradient tap inline-flex w-fit items-center gap-1.5',
                            'rounded-lg px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-60'
                          )}
                        >
                          {busy === episode.episodeId ? (
                            <Loader2 aria-hidden className="size-3.5 animate-spin" />
                          ) : (
                            <Headphones aria-hidden className="size-3.5" />
                          )}
                          產生有聲書
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {isOpen && state?.note && !working && (
                <p className="text-[10px] text-ink-700">{state.note}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
