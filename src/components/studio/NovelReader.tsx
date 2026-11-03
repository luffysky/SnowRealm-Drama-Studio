'use client'

import { ChevronLeft, ChevronRight, List, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  loadReaderSettings,
  READER_DEFAULTS,
  READER_FONT_LABEL,
  READER_FONT_STACK,
  READER_FONTS,
  READER_THEME_COLORS,
  READER_THEME_LABEL,
  READER_THEMES,
  READING_MODE_HINT,
  READING_MODE_LABEL,
  READING_MODES,
  saveReaderSettings,
  type ReaderSettings,
} from '@/lib/novel-reader-view'
import { cn } from '@/lib/utils'

/**
 * 小說閱讀器.
 *
 * The editor is for writing; this is for reading what was written, in one
 * continuous book rather than one episode at a time. Everything it offers —
 * type size, line spacing, reading direction, page colour, dimming — is a
 * property of the person and the screen, so it is kept in `localStorage` and
 * never sent to the server: one member's phone must not resize the other's
 * desk.
 *
 * Three reading modes, because they are genuinely different habits and not
 * skins of each other: a scroll, discrete pages, and pages with the turn
 * animated. `prefers-reduced-motion` collapses 模擬翻書 to a plain page change,
 * since a 0.4s rotation on every page is exactly what that setting is for.
 */

export type ReaderChapter = {
  id: string
  episodeId: string
  episodeNumber: number
  episodeTitle: string
  chapterTitle: string
  /** Paragraphs, already converted from the editor's HTML on the server. */
  paragraphs: string[]
  charCount: number
}

export function NovelReader({
  bookTitle,
  chapters,
  initialChapterId,
}: {
  bookTitle: string
  chapters: ReaderChapter[]
  initialChapterId?: string | undefined
}) {
  /*
   * `localStorage` does not exist during the server render.
   * `useSyncExternalStore` rather than an effect, which is what
   * `react-hooks/set-state-in-effect` forbids and exactly the
   * "read a client-only value" case it is for — same pattern as `Dialog`.
   */
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )

  const [stored, setStored] = useState<ReaderSettings | null>(null)
  const settings = stored ?? (ready ? loadReaderSettings() : READER_DEFAULTS)
  const [panel, setPanel] = useState<'none' | 'toc' | 'settings'>('none')
  const [index, setIndex] = useState(() => {
    const found = chapters.findIndex((c) => c.id === initialChapterId)
    return found >= 0 ? found : 0
  })
  const [page, setPage] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [turning, setTurning] = useState<'none' | 'next' | 'prev'>('none')

  const pagerRef = useRef<HTMLDivElement | null>(null)

  const update = useCallback((changes: Partial<ReaderSettings>) => {
    setStored((current) => {
      const next = { ...(current ?? loadReaderSettings()), ...changes }
      saveReaderSettings(next)
      return next
    })
  }, [])

  const chapter = chapters[index]
  const theme = READER_THEME_COLORS[settings.theme]
  const paged = settings.mode !== 'scroll'

  /* --------------------------------------------------------------- paging */

  /**
   * How many columns the text actually occupies.
   *
   * Measured from the scroll width rather than estimated from the character
   * count: CSS columns decide where the text breaks, and any estimate here
   * would disagree with them and leave a page that cannot be reached.
   */
  const measure = useCallback(() => {
    const node = pagerRef.current
    if (!node || !paged) return

    const width = node.clientWidth
    if (width <= 0) return

    const total = Math.max(1, Math.round(node.scrollWidth / width))
    setPageCount(total)
    setPage((current) => Math.min(current, total - 1))
  }, [paged])

  useEffect(() => {
    measure()
  }, [measure, index, settings.fontSize, settings.lineHeight, settings.font, ready])

  useEffect(() => {
    if (!paged) return
    const node = pagerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [measure, paged])

  useEffect(() => {
    const node = pagerRef.current
    if (node && paged) node.scrollTo({ left: page * node.clientWidth, behavior: 'auto' })
  }, [page, paged])

  const goChapter = useCallback(
    (next: number) => {
      if (next < 0 || next >= chapters.length) return
      setIndex(next)
      setPage(0)
      window.scrollTo({ top: 0, behavior: 'auto' })
      pagerRef.current?.scrollTo({ left: 0, behavior: 'auto' })
    },
    [chapters.length]
  )

  const flip = useCallback(
    (direction: 'next' | 'prev') => {
      if (!paged) {
        goChapter(index + (direction === 'next' ? 1 : -1))
        return
      }

      const target = page + (direction === 'next' ? 1 : -1)

      // Past either end of the chapter, carry on into the next one rather
      // than stopping — a book does not stop at a chapter boundary.
      if (target < 0) {
        if (index > 0) goChapter(index - 1)
        return
      }
      if (target >= pageCount) {
        if (index < chapters.length - 1) goChapter(index + 1)
        return
      }

      if (settings.mode === 'flip' && !prefersReducedMotion()) {
        setTurning(direction)
        window.setTimeout(() => {
          setPage(target)
          setTurning('none')
        }, 180)
      } else {
        setPage(target)
      }
    },
    [paged, page, pageCount, index, chapters.length, goChapter, settings.mode]
  )

  /* ------------------------------------------------------------- gestures */

  const touch = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') flip('next')
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') flip('prev')
      if (event.key === 'Escape') setPanel('none')
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip])

  /* --------------------------------------------------------------- render */

  if (!chapter) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-200">還沒有可以讀的內容</p>
          <p className="text-[11px] text-ink-600">在小說編輯器寫下第一章之後，這裡就會有東西。</p>
        </div>
      </div>
    )
  }

  const body = (
    <article
      className="reader-prose"
      style={{
        fontFamily: READER_FONT_STACK[settings.font],
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineHeight,
        color: theme.ink,
      }}
    >
      <header className="mb-6">
        <p className="mb-1 text-center" style={{ fontSize: '0.7em', color: theme.faint }}>
          EP{String(chapter.episodeNumber).padStart(3, '0')}
          {chapter.episodeTitle && `・${chapter.episodeTitle}`}
        </p>
        <h2 className="text-center font-medium" style={{ fontSize: '1.15em' }}>
          {chapter.chapterTitle || chapter.episodeTitle || '未命名'}
        </h2>
      </header>

      {chapter.paragraphs.map((paragraph, i) => (
        <p key={i} style={{ textIndent: '2em', margin: '0 0 0.9em' }}>
          {paragraph}
        </p>
      ))}
    </article>
  )

  return (
    <div
      className="relative min-h-[calc(100dvh-8rem)] transition-colors"
      style={{ background: theme.bg }}
    >
      {/*
        Dimming is an overlay rather than a CSS `filter` on the content: a
        filter creates a containing block, which breaks `position: fixed` for
        anything inside it — including the settings panel.
      */}
      {settings.brightness < 1 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20 bg-black"
          style={{ opacity: 1 - settings.brightness }}
        />
      )}

      {/* ---- toolbar ---------------------------------------------------- */}
      <div
        className="sticky top-0 z-30 flex items-center gap-2 border-b px-3 py-2 backdrop-blur-sm"
        style={{
          borderColor: `${theme.faint}33`,
          background: `${theme.bg}e6`,
          color: theme.ink,
        }}
      >
        <button
          type="button"
          onClick={() => setPanel(panel === 'toc' ? 'none' : 'toc')}
          className="tap inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-opacity hover:opacity-70"
        >
          <List aria-hidden className="size-3.5" />
          目錄
        </button>

        <span className="min-w-0 flex-1 truncate text-center text-[11px]" style={{ color: theme.faint }}>
          {bookTitle}
        </span>

        <button
          type="button"
          onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          className="tap inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-opacity hover:opacity-70"
        >
          <Settings2 aria-hidden className="size-3.5" />
          閱讀設定
        </button>
      </div>

      {/* ---- the page --------------------------------------------------- */}
      <div
        className="relative mx-auto w-full max-w-2xl px-5 py-8 sm:px-8"
        onTouchStart={(event) => {
          const point = event.touches[0]
          if (point) touch.current = { x: point.clientX, y: point.clientY }
        }}
        onTouchEnd={(event) => {
          const start = touch.current
          const point = event.changedTouches[0]
          touch.current = null
          if (!start || !point || !paged) return

          const dx = point.clientX - start.x
          const dy = point.clientY - start.y
          // Only a mostly-horizontal swipe turns a page; otherwise a diagonal
          // scroll flips pages while someone is trying to scroll.
          if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return

          flip(dx < 0 ? 'next' : 'prev')
        }}
      >
        {paged ? (
          <div
            className={cn(
              'origin-left transition-transform duration-150',
              settings.mode === 'flip' && turning === 'next' && 'scale-x-[0.97] opacity-80',
              settings.mode === 'flip' && turning === 'prev' && 'scale-x-[1.03] opacity-80'
            )}
            style={{ perspective: settings.mode === 'flip' ? '1600px' : undefined }}
          >
            <div
              ref={pagerRef}
              className="overflow-hidden"
              style={{
                height: 'calc(100dvh - 15rem)',
                columnWidth: '100vw',
                columnGap: 0,
                columnFill: 'auto',
              }}
            >
              {body}
            </div>
          </div>
        ) : (
          body
        )}

        {/* ---- chapter / page controls -------------------------------- */}
        <nav
          className="mt-6 flex items-center justify-between gap-3 text-[11px]"
          style={{ color: theme.faint }}
        >
          <button
            type="button"
            onClick={() => flip('prev')}
            disabled={index === 0 && page === 0}
            className="tap inline-flex items-center gap-1 rounded-md px-2 py-1 transition-opacity hover:opacity-70 disabled:opacity-30"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            {paged ? '上一頁' : '上一章'}
          </button>

          <span className="tabular-nums">
            {paged && `${page + 1} / ${pageCount}　`}
            第 {index + 1} / {chapters.length} 章
          </span>

          <button
            type="button"
            onClick={() => flip('next')}
            disabled={index === chapters.length - 1 && (!paged || page >= pageCount - 1)}
            className="tap inline-flex items-center gap-1 rounded-md px-2 py-1 transition-opacity hover:opacity-70 disabled:opacity-30"
          >
            {paged ? '下一頁' : '下一章'}
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </nav>
      </div>

      {/* ---- panels ----------------------------------------------------- */}
      {panel !== 'none' && (
        <>
          <button
            type="button"
            aria-label="關閉面板"
            onClick={() => setPanel('none')}
            className="fixed inset-0 z-40 cursor-default bg-black/40"
          />
          <div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t p-4 shadow-2xl sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:max-h-none sm:w-80 sm:rounded-none sm:border-t-0 sm:border-l"
            style={{ background: theme.bg, borderColor: `${theme.faint}44`, color: theme.ink }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold">
                {panel === 'toc' ? '目錄' : '閱讀設定'}
              </h3>
              <button
                type="button"
                onClick={() => setPanel('none')}
                aria-label="關閉"
                className="rounded p-1 transition-opacity hover:opacity-70"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {panel === 'toc' ? (
              <ol className="flex flex-col gap-0.5">
                {chapters.map((item, i) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        goChapter(i)
                        setPanel('none')
                      }}
                      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors"
                      style={
                        i === index
                          ? { background: `${theme.faint}2a`, fontWeight: 600 }
                          : undefined
                      }
                    >
                      <span className="shrink-0 tabular-nums" style={{ color: theme.faint }}>
                        {String(item.episodeNumber).padStart(3, '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {item.chapterTitle || item.episodeTitle || '未命名'}
                      </span>
                      <span className="shrink-0 tabular-nums" style={{ color: theme.faint }}>
                        {item.charCount.toLocaleString('en-US')}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex flex-col gap-4">
                <Field label="閱讀方式" hint={READING_MODE_HINT[settings.mode]}>
                  <div className="grid grid-cols-3 gap-1">
                    {READING_MODES.map((mode) => (
                      <Choice
                        key={mode}
                        active={settings.mode === mode}
                        theme={theme}
                        onClick={() => {
                          update({ mode })
                          setPage(0)
                        }}
                      >
                        {READING_MODE_LABEL[mode]}
                      </Choice>
                    ))}
                  </div>
                </Field>

                <Field label="背景">
                  <div className="grid grid-cols-5 gap-1">
                    {READER_THEMES.map((key) => {
                      const colors = READER_THEME_COLORS[key]
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => update({ theme: key })}
                          aria-label={READER_THEME_LABEL[key]}
                          aria-pressed={settings.theme === key}
                          title={READER_THEME_LABEL[key]}
                          className={cn(
                            'flex h-10 flex-col items-center justify-center rounded-md border text-[9px] transition-all',
                            settings.theme === key ? 'ring-2' : 'opacity-80 hover:opacity-100'
                          )}
                          style={{
                            background: colors.bg,
                            color: colors.ink,
                            borderColor: `${colors.faint}66`,
                            ...(settings.theme === key
                              ? ({ '--tw-ring-color': theme.ink } as React.CSSProperties)
                              : {}),
                          }}
                        >
                          {READER_THEME_LABEL[key]}
                        </button>
                      )
                    })}
                  </div>
                </Field>

                <Field label="字體">
                  <div className="grid grid-cols-2 gap-1">
                    {READER_FONTS.map((font) => (
                      <Choice
                        key={font}
                        active={settings.font === font}
                        theme={theme}
                        onClick={() => update({ font })}
                      >
                        <span style={{ fontFamily: READER_FONT_STACK[font] }}>
                          {READER_FONT_LABEL[font]}
                        </span>
                      </Choice>
                    ))}
                  </div>
                </Field>

                <Slider
                  label="字級"
                  value={settings.fontSize}
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  display={`${settings.fontSize}px`}
                  theme={theme}
                  onChange={(fontSize) => update({ fontSize })}
                />

                <Slider
                  label="行距"
                  value={settings.lineHeight}
                  min={LINE_HEIGHT_MIN}
                  max={LINE_HEIGHT_MAX}
                  step={0.05}
                  display={settings.lineHeight.toFixed(2)}
                  theme={theme}
                  onChange={(lineHeight) => update({ lineHeight })}
                />

                <Slider
                  label="亮度"
                  value={settings.brightness}
                  min={BRIGHTNESS_MIN}
                  max={BRIGHTNESS_MAX}
                  step={0.05}
                  display={`${Math.round(settings.brightness * 100)}%`}
                  theme={theme}
                  onChange={(brightness) => update({ brightness })}
                />

                <p className="text-[10px] leading-relaxed" style={{ color: theme.faint }}>
                  這些設定只存在這台裝置的瀏覽器裡，不會同步給另一位成員。
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-[10px] opacity-60">{hint}</span>}
    </div>
  )
}

function Choice({
  active,
  theme,
  onClick,
  children,
}: {
  active: boolean
  theme: { ink: string; faint: string }
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-md border px-2 py-1.5 text-[11px] transition-all"
      style={{
        borderColor: active ? theme.ink : `${theme.faint}55`,
        fontWeight: active ? 600 : 400,
        opacity: active ? 1 : 0.7,
      }}
    >
      {children}
    </button>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  theme,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  theme: { ink: string; faint: string }
  onChange: (value: number) => void
}) {
  const id = `reader-${label}`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between text-[11px] font-medium">
        {label}
        <span className="tabular-nums" style={{ color: theme.faint }}>
          {display}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: `${theme.faint}55`, accentColor: theme.ink }}
      />
    </div>
  )
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Never changes, so `useSyncExternalStore` only needs the two snapshots. */
function subscribeNever(): () => void {
  return () => {}
}
