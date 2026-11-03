'use client'

import { Check, Copy, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import {
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_HINT,
  NOVEL_EXPORT_LABEL,
  type NovelExportFormat,
} from '@/lib/novel-export-view'
import { cn } from '@/lib/utils'

/**
 * 匯出整本小說 (Z92) and 一鍵複製 (Z93).
 *
 * Both go through `GET /api/projects/[id]/novel/export`, which is the point:
 * the text someone copies and the file they download are built by the same
 * code, so they cannot drift apart. Copy adds `inline=1`, which only drops the
 * Content-Disposition header.
 */

export type ExportEpisode = {
  episodeId: string
  number: number
  title: string
  charCount: number
}

export function NovelExportMenu({
  projectId,
  episodes,
}: {
  projectId: string
  /** Episodes that actually have prose. Empty disables both buttons. */
  episodes: ExportEpisode[]
}) {
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<NovelExportFormat>('txt')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)

  // An empty selection means "everything", which is also what the API does
  // with no `episodes` parameter — so the common case needs no ticking.
  const all = selected.size === 0
  const chosen = all ? episodes : episodes.filter((e) => selected.has(e.episodeId))
  const chars = chosen.reduce((n, e) => n + e.charCount, 0)

  function toggle(episodeId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(episodeId)) next.delete(episodeId)
      else next.add(episodeId)
      return next
    })
  }

  function query(extra?: string): string {
    const params = new URLSearchParams({ format })
    if (!all) params.set('episodes', [...selected].join(','))
    return `/api/projects/${projectId}/novel/export?${params.toString()}${extra ?? ''}`
  }

  /**
   * Copies the whole novel as plain text.
   *
   * The clipboard write has to happen in the same user gesture that started
   * it, or Safari refuses — so the fetch comes first and the write second,
   * inside the same handler, never behind a `setState` round trip.
   */
  async function copyAll() {
    setCopying(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/novel/export?format=txt&inline=1${
          all ? '' : `&episodes=${[...selected].join(',')}`
        }`
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      // The TXT export carries a BOM for Windows' sake; it has no business in
      // a clipboard and shows up as a stray character when pasted.
      const text = (await response.text()).replace(/^﻿/, '')

      if (!navigator.clipboard?.writeText) {
        throw new Error('這個瀏覽器不允許寫入剪貼簿，請改用匯出')
      }
      await navigator.clipboard.writeText(text)

      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
      toast.success(
        '已複製整本小說',
        `${chosen.length} 集・${text.replace(/\s/g, '').length.toLocaleString('en-US')} 字`
      )
    } catch (cause) {
      toast.error('複製失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setCopying(false)
    }
  }

  const disabled = episodes.length === 0

  return (
    <>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void copyAll()}
          disabled={disabled || copying}
          title={disabled ? '還沒有寫好的章節可以複製' : '複製整本小說的內文'}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stage-800 px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copying ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : copied ? (
            <Check aria-hidden className="size-3.5 text-emerald-400" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          {copied ? '已複製' : '複製全文'}
        </button>

        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={disabled ? '還沒有寫好的章節可以匯出' : '匯出小說'}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stage-800 px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download aria-hidden className="size-3.5" />
          匯出
        </button>
      </div>

      <Dialog
        open={open}
        onRequestClose={() => setOpen(false)}
        title="匯出小說"
        description="不勾任何一集就是整本匯出。"
        size="sm"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            {/*
              A plain anchor, not a fetch-and-blob: the browser's own download
              manager handles a slow build, and a blob held in a tab is lost
              to a refresh.
            */}
            <a
              href={query()}
              download
              onClick={() => setOpen(false)}
              className={cn(
                'bg-brand-gradient glow-accent-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90',
                chosen.length === 0 && 'pointer-events-none opacity-40'
              )}
            >
              <Download aria-hidden className="size-3.5" />
              下載 {NOVEL_EXPORT_LABEL[format].split(' ')[0]}
            </a>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-ink-200">格式</span>
            <div className="grid grid-cols-2 gap-1.5">
              {NOVEL_EXPORT_FORMATS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormat(key)}
                  aria-pressed={format === key}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors',
                    format === key
                      ? 'border-accent-500 bg-accent-600/15 font-medium text-ink-50'
                      : 'border-stage-700 text-ink-400 hover:border-stage-600 hover:text-ink-200'
                  )}
                >
                  {NOVEL_EXPORT_LABEL[key]}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-ink-600">
              {NOVEL_EXPORT_HINT[format]}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-ink-200">集數</span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={all}
                className="text-[10px] text-ink-500 underline-offset-2 transition-colors hover:text-ink-200 hover:underline disabled:opacity-40"
              >
                全部
              </button>
            </div>

            <ul className="max-h-56 overflow-y-auto rounded-lg ring-1 ring-stage-700">
              {episodes.map((episode) => {
                const ticked = all || selected.has(episode.episodeId)
                return (
                  <li key={episode.episodeId}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-stage-800',
                        ticked ? 'text-ink-100' : 'text-ink-500'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={() => toggle(episode.episodeId)}
                        className="size-3.5 accent-accent-500"
                      />
                      <span className="shrink-0 tabular-nums">
                        EP{String(episode.number).padStart(3, '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {episode.title || '未命名'}
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-600 tabular-nums">
                        {episode.charCount.toLocaleString('en-US')}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>

            <p className="text-[10px] text-ink-600 tabular-nums">
              {all ? '整本' : `已選 ${chosen.length} 集`}・
              {chars.toLocaleString('en-US')} 字
            </p>
          </div>
        </div>
      </Dialog>
    </>
  )
}
