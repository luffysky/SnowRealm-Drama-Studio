'use client'

import { BookOpen, Headphones, Users } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { AudiobookPanel } from '@/components/studio/AudiobookPanel'
import { CHARACTER_TIER_LABEL, type CharacterTierValue } from '@/lib/constants'

/**
 * 一本書的三個分頁 (Z136).
 *
 * 目錄、簡介、有聲。**正文不在這裡**——閱讀器是 `fixed inset-0` 的覆蓋層，
 * 放進分頁會蓋掉分頁列本身，而且讀小說本來就該佔滿整個螢幕。所以它是上面
 * 那顆「開始閱讀」，退出時回到這一頁。
 *
 * 刻意沒有排行榜、分類篩選、字數級距那些：那是幾十萬本書撐起來的東西，
 * 兩部作品套上去就是一堆空畫面。留下的是這裡真的有資料的部分。
 */

export type BookChapter = { id: string; title: string; charCount: number }

export type BookEpisode = {
  episodeId: string
  number: number
  title: string
  charCount: number
  chapters: BookChapter[]
  arcId: string | null
  audio: { assetId: string; durationSec: number | null; sizeBytes: number } | null
}

export type BookArc = { id: string; index: number; title: string; logline: string }

export type BookCast = {
  id: string
  name: string
  alias: string
  tier: CharacterTierValue
  gender: string
  note: string
  episodeCount: number
}

type Panel = 'toc' | 'about' | 'audio'

export function BookTabs({
  projectId,
  title,
  logline,
  synopsis,
  targetChars,
  canGenerate,
  arcs,
  episodes,
  cast,
}: {
  projectId: string
  title: string
  logline: string
  synopsis: string
  targetChars: number
  canGenerate: boolean
  arcs: BookArc[]
  episodes: BookEpisode[]
  cast: BookCast[]
}) {
  const [panel, setPanel] = useState<Panel>('toc')

  const totals = useMemo(() => {
    const chars = episodes.reduce((sum, episode) => sum + episode.charCount, 0)
    const withAudio = episodes.filter((episode) => episode.audio).length
    const target = targetChars * episodes.length

    return {
      chars,
      chapters: episodes.reduce((sum, episode) => sum + episode.chapters.length, 0),
      withAudio,
      percent: target > 0 ? Math.min(100, Math.round((chars / target) * 100)) : 0,
    }
  }, [episodes, targetChars])

  const firstChapter = episodes[0]?.chapters[0]?.id

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      {/* ---- the book ---------------------------------------------------- */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-medium text-ink-50">{title}</h1>
          <Link href="/read" className="text-[11px] text-ink-500 hover:text-ink-200">
            返回書架
          </Link>
        </div>

        {logline && <p className="text-[12px] leading-relaxed text-ink-400">{logline}</p>}

        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-600 tabular-nums">
          <span>{episodes.length} 集</span>
          <span>{totals.chapters} 章</span>
          <span>{totals.chars.toLocaleString('zh-TW')} 字</span>
          {totals.withAudio > 0 && <span>{totals.withAudio} 集有聲書</span>}
        </p>

        <Link
          href={`/read/${projectId}/text${firstChapter ? `?chapter=${firstChapter}` : ''}`}
          className="bg-brand-gradient glow-accent-sm tap inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <BookOpen aria-hidden className="size-4" />
          開始閱讀
        </Link>
      </header>

      <Tabs
        appearance="pill"
        activeId={panel}
        onChange={(id) => setPanel(id as Panel)}
        tabs={[
          { id: 'toc', label: '目錄', badge: episodes.length },
          { id: 'about', label: '簡介' },
          {
            id: 'audio',
            label: '有聲',
            badge: totals.withAudio > 0 ? totals.withAudio : undefined,
          },
        ]}
      />

      {panel === 'toc' && (
        <Toc projectId={projectId} arcs={arcs} episodes={episodes} />
      )}

      {panel === 'about' && (
        <About
          synopsis={synopsis}
          cast={cast}
          chars={totals.chars}
          percent={totals.percent}
          targetChars={targetChars}
          episodes={episodes.length}
        />
      )}

      {panel === 'audio' && (
        <AudiobookPanel
          projectId={projectId}
          episodes={episodes}
          canGenerate={canGenerate}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 卷 → 集 → 章，三層.
 *
 * 卷那一層只有在真的有不只一卷的時候才出現。一個容器不是分類法，只是這部
 * 作品本身——為它畫一層標題是多一層要點開的東西。
 */
function Toc({
  projectId,
  arcs,
  episodes,
}: {
  projectId: string
  arcs: BookArc[]
  episodes: BookEpisode[]
}) {
  const grouped = useMemo(() => {
    if (arcs.length <= 1) return [{ arc: null, episodes }]

    return arcs
      .map((arc) => ({
        arc,
        episodes: episodes.filter((episode) => episode.arcId === arc.id),
      }))
      .filter((group) => group.episodes.length > 0)
  }, [arcs, episodes])

  return (
    <div className="flex flex-col gap-4">
      {grouped.map((group) => (
        <section key={group.arc?.id ?? 'all'} className="flex flex-col gap-1.5">
          {group.arc && (
            <h2 className="flex flex-wrap items-baseline gap-x-2 text-[12px] font-medium text-ink-200">
              第{group.arc.index}卷《{group.arc.title}》
              <span className="text-[10px] font-normal text-ink-600">
                {group.episodes.length} 集
              </span>
            </h2>
          )}

          <ul className="flex flex-col gap-1">
            {group.episodes.map((episode) => (
              <li
                key={episode.episodeId}
                className="rounded-lg bg-stage-900 ring-1 ring-stage-700/60"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 border-b border-stage-700/40 px-3 py-2">
                  <span className="text-[11px] text-ink-500 tabular-nums">
                    EP{String(episode.number).padStart(3, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">
                    {episode.title || '未命名'}
                  </span>
                  <span className="text-[10px] text-ink-600 tabular-nums">
                    {episode.charCount.toLocaleString('zh-TW')} 字
                  </span>
                  {episode.audio && (
                    <Headphones
                      aria-label="有聲書"
                      className="size-3 shrink-0 text-accent-400"
                    />
                  )}
                </div>

                <ul className="flex flex-col">
                  {episode.chapters.map((chapter) => (
                    <li key={chapter.id}>
                      <Link
                        href={`/read/${projectId}/text?chapter=${chapter.id}`}
                        className="tap flex items-baseline gap-2 px-3 py-1.5 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {chapter.title || '未命名章節'}
                        </span>
                        <span className="shrink-0 text-[10px] text-ink-700 tabular-nums">
                          {chapter.charCount.toLocaleString('zh-TW')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function About({
  synopsis,
  cast,
  chars,
  percent,
  targetChars,
  episodes,
}: {
  synopsis: string
  cast: BookCast[]
  chars: number
  percent: number
  targetChars: number
  episodes: number
}) {
  return (
    <div className="flex flex-col gap-4">
      {synopsis ? (
        <section className="rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700/60">
          <h2 className="mb-1.5 text-[11px] font-medium text-ink-300">故事簡介</h2>
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-ink-400">
            {synopsis}
          </p>
        </section>
      ) : (
        <p className="rounded-xl bg-stage-900 px-3 py-6 text-center text-[11px] text-ink-600 ring-1 ring-stage-700/60">
          還沒有寫故事簡介。到作品設定補上，這裡就會顯示。
        </p>
      )}

      <section className="flex flex-col gap-1.5 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700/60">
        <h2 className="text-[11px] font-medium text-ink-300">進度</h2>
        <div className="h-1.5 overflow-hidden rounded-full bg-stage-800">
          <div
            aria-hidden
            className="h-full rounded-full bg-accent-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-[10px] text-ink-600 tabular-nums">
          已寫 {chars.toLocaleString('zh-TW')} 字，目標{' '}
          {(targetChars * episodes).toLocaleString('zh-TW')} 字（{episodes} 集 ×{' '}
          {targetChars.toLocaleString('zh-TW')}）・{percent}%
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium text-ink-300">
          <Users aria-hidden className="size-3" />
          角色 {cast.length > 0 && <span className="text-ink-600">{cast.length}</span>}
        </h2>

        {cast.length === 0 ? (
          <p className="rounded-xl bg-stage-900 px-3 py-6 text-center text-[11px] leading-relaxed text-ink-600 ring-1 ring-stage-700/60">
            角色表是空的。分角色朗讀與有聲書的配音都靠它——沒有角色，對白只會用
            旁白的聲音唸。
          </p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {cast.map((character) => (
              <li
                key={character.id}
                className="flex flex-col gap-0.5 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
              >
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[12px] text-ink-100">{character.name}</span>
                  {character.alias && (
                    <span className="text-[10px] text-ink-600">{character.alias}</span>
                  )}
                  <span className="rounded bg-stage-800 px-1.5 py-0.5 text-[9px] text-ink-500">
                    {CHARACTER_TIER_LABEL[character.tier] ?? character.tier}
                  </span>
                  {character.gender && (
                    <span className="text-[10px] text-ink-600">{character.gender}</span>
                  )}
                </p>
                {character.note && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-500">
                    {character.note}
                  </p>
                )}
                <p className="text-[10px] text-ink-700 tabular-nums">
                  {character.episodeCount > 0
                    ? `出現於 ${character.episodeCount} 集`
                    : '還沒在正文裡出現'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

