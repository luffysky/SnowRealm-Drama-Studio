'use client'

import {
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  Upload,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { usePlayer } from '@/components/studio/PlayerProvider'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  clearStamp,
  formatLrcTime,
  parseLyrics,
  stampLine,
  stampProgress,
  toLrc,
  type LyricLine,
} from '@/lib/lyrics'
import type { AlignedLine } from '@/lib/lyrics-align'
import { cn } from '@/lib/utils'

/**
 * 貼上、上傳，然後邊聽邊點時間 (Z125).
 *
 * 「手打時間碼沒人受得了」—— and that is the whole design. Timing a song by
 * typing `[01:23.45]` forty times is a job nobody finishes, so the second tab
 * plays the track and stamps whatever line you are on when you press. One
 * key, once per line, in time with the music.
 *
 * Three decisions that matter more than they look:
 *
 *  1. **Space is the tap.** Hands stay still, eyes stay on the words. The
 *     textarea in the other tab is why this is a separate tab rather than a
 *     mode — space has to mean space while you are typing.
 *  2. **Nothing is reordered while tapping.** `stampLine` keeps the list in
 *     place; re-sorting on each press would move the next line out from under
 *     your finger. Sorting happens on save, when it is parsed back.
 *  3. **A tap is undoable and a line is re-tappable.** Everyone misses, and
 *     a timing pass you cannot correct is one you start over.
 */

type Tab = 'text' | 'sync'

export function LyricsEditor({
  projectId,
  assetId,
  initial,
  onClose,
  onSaved,
}: {
  projectId: string
  assetId: string
  initial: string
  onClose: () => void
  onSaved: (lyrics: string) => void
}) {
  const player = usePlayer()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [tab, setTab] = useState<Tab>('text')
  const [text, setText] = useState(initial)
  const [lines, setLines] = useState<LyricLine[]>(() => parseLyrics(initial).lines)
  const [cursor, setCursor] = useState(0)
  const [saving, setSaving] = useState(false)

  /** 用聽的標時間 (Z131): in flight, and what came back. */
  const [aligning, setAligning] = useState(false)
  const [aligned, setAligned] = useState<AlignedLine[] | null>(null)
  const [coverage, setCoverage] = useState<number | null>(null)

  /** Is the global player on this very track? Tapping needs it to be. */
  const live = player.track?.assetId === assetId

  const progress = stampProgress(lines)

  /** Text tab is the source of truth until the sync tab is opened. */
  function openSync() {
    setLines(parseLyrics(text).lines)
    setCursor(0)
    setTab('sync')
  }

  /** Sync tab is the source of truth until the text tab is opened. */
  function openText() {
    setText(toLrc({ lines, meta: {}, timed: lines.some((l) => l.timeMs !== null) }))
    setTab('text')
  }

  async function onFile(file: File) {
    /*
     * Read as text, whatever the extension. `.lrc` and `.txt` are the two
     * anybody has, and refusing a correctly-formatted file because it was
     * named `.lyrics` would be pedantry.
     */
    try {
      const content = await file.text()
      setText(content)
      setLines(parseLyrics(content).lines)
      toast.success(`讀進 ${file.name}`, parseLyrics(content).timed ? '帶時間碼，可以直接跟著走。' : '沒有時間碼，到「打時間」那一頁點上去。')
    } catch {
      toast.error('讀不到這個檔案')
    }
  }

  /**
   * 讓它聽一遍，把時間標上去.
   *
   * Aligns what is **on screen**, not what is saved — text pasted a moment
   * ago has not been written yet, and timing the saved copy would stamp the
   * wrong words.
   *
   * The proposal lands in the list as ordinary stamps, so every one of them
   * can be re-tapped or cleared exactly like a hand-made one. Nothing is
   * saved until 儲存.
   */
  async function alignByEar() {
    const source = tab === 'sync' ? toLrc({ lines, meta: {}, timed: true }) : text
    if (!source.trim()) {
      toast.error('先貼上歌詞')
      return
    }

    setAligning(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/assets/music/${assetId}/lyrics/align`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lyrics: source }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as {
        lines: AlignedLine[]
        coverage: number
        wordCount: number
      }

      setAligned(body.lines)
      setCoverage(body.coverage)
      setLines(body.lines.map((row) => ({ timeMs: row.timeMs, text: row.text })))
      setCursor(0)
      setTab('sync')

      const stamped = body.lines.filter((row) => row.timeMs !== null).length
      toast.success(
        `標上 ${stamped} / ${body.lines.length} 句`,
        body.coverage < 0.4
          ? '對上的字不多——唱歌比講話難辨識，請把每一句聽過再存。'
          : '這是建議值，聽過確認再存。'
      )
    } catch (cause) {
      toast.error('標時間失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setAligning(false)
    }
  }

  async function save() {
    const payload = tab === 'sync' ? toLrc({ lines, meta: {}, timed: true }) : text

    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/assets/music/${assetId}/lyrics`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lyrics: payload }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      onSaved(payload)
      toast.success('歌詞已儲存')
      onClose()
    } catch (cause) {
      toast.error('儲存失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  /** Stamp the line under the cursor and step to the next one. */
  function tap() {
    if (!live) return
    setLines((previous) => stampLine(previous, cursor, player.current))
    setCursor((n) => Math.min(n + 1, lines.length - 1))
  }

  function download() {
    const payload = tab === 'sync' ? toLrc({ lines, meta: {}, timed: true }) : text
    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${player.track?.title || 'lyrics'}.lrc`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog
      open
      onRequestClose={() => {
        if (saving) return
        onClose()
      }}
      title="歌詞"
      description="貼上或上傳歌詞；要讓它跟著歌走，到「打時間」那一頁邊聽邊點。"
      size="lg"
      busy={saving}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={download}
            className="tap inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-200"
          >
            <Download aria-hidden className="size-3" />
            下載 .lrc
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="tap rounded-lg bg-stage-800 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-stage-700"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="tap rounded-lg bg-accent-600 px-3 py-1.5 text-[11px] text-white hover:bg-accent-500 disabled:opacity-50"
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* ---- tabs --------------------------------------------------- */}
        <div className="flex gap-1 self-start rounded-lg bg-stage-900 p-0.5 ring-1 ring-stage-700">
          <button
            type="button"
            onClick={openText}
            aria-pressed={tab === 'text'}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] transition-colors',
              tab === 'text'
                ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                : 'text-ink-400 hover:text-ink-100'
            )}
          >
            文字
          </button>
          <button
            type="button"
            onClick={openSync}
            aria-pressed={tab === 'sync'}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] transition-colors',
              tab === 'sync'
                ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                : 'text-ink-400 hover:text-ink-100'
            )}
          >
            打時間
            <span className="ml-1 text-[9px] tabular-nums opacity-70">
              {progress.stamped}/{progress.total}
            </span>
          </button>
        </div>

        {tab === 'text' ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".lrc,.txt,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void onFile(file)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="tap inline-flex items-center gap-1 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-300 hover:bg-stage-700 hover:text-ink-100"
              >
                <Upload aria-hidden className="size-3" />
                上傳 .lrc / .txt
              </button>
              <p className="text-[10px] text-ink-600">
                也可以直接貼進下面。帶 <span className="font-mono">[mm:ss.xx]</span>{' '}
                的會自動認成有時間碼的歌詞。
              </p>
            </div>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={'一句一行。\n\n或貼 LRC：\n[00:12.34]第一句\n[00:18.90]第二句'}
              className="w-full rounded-lg bg-stage-950/60 p-3 font-mono text-[12px] leading-relaxed text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
            />
          </>
        ) : (
          <SyncTab
            lines={lines}
            cursor={cursor}
            live={live}
            aligned={aligned}
            coverage={coverage}
            aligning={aligning}
            onAlign={() => void alignByEar()}
            onPick={setCursor}
            onTap={tap}
            onClear={(index) => {
              setLines((previous) => clearStamp(previous, index))
              setAligned(null)
            }}
            onReset={() => {
              setLines((previous) => previous.map((line) => ({ ...line, timeMs: null })))
              setAligned(null)
              setCoverage(null)
              setCursor(0)
            }}
          />
        )}
      </div>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

function SyncTab({
  lines,
  cursor,
  live,
  aligned,
  coverage,
  aligning,
  onAlign,
  onPick,
  onTap,
  onClear,
  onReset,
}: {
  lines: LyricLine[]
  cursor: number
  live: boolean
  /** The last proposal, so low-confidence lines can be flagged (Z131). */
  aligned: AlignedLine[] | null
  coverage: number | null
  aligning: boolean
  onAlign: () => void
  onPick: (index: number) => void
  onTap: () => void
  onClear: (index: number) => void
  onReset: () => void
}) {
  const player = usePlayer()

  if (lines.length === 0) {
    return (
      <p className="rounded-lg bg-stage-900 px-3 py-6 text-center text-[11px] text-ink-600 ring-1 ring-stage-700/60">
        先到「文字」那一頁貼上歌詞，再回來打時間。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/*
        讓它先聽一遍 (Z131).

        Framed as a first pass, not an answer. Singing over a backing track is
        much harder to recognise than speech, so what this buys is 「大致都標
        好了，剩下微調」 rather than 「不用聽了」 —— and the wording says so
        rather than letting the button imply otherwise.
      */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60">
        <button
          type="button"
          onClick={onAlign}
          disabled={aligning}
          className="bg-brand-gradient tap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-60"
        >
          {aligning ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Sparkles aria-hidden className="size-3.5" />
          )}
          {aligning ? '正在聽…' : '讓 AI 聽一遍，先標好時間'}
        </button>

        {coverage !== null ? (
          <span
            className={cn(
              'text-[10px]',
              coverage >= 0.6 ? 'text-emerald-300' : coverage >= 0.3 ? 'text-amber-300' : 'text-rose-300'
            )}
          >
            對上 {Math.round(coverage * 100)}% 的字
            {coverage < 0.6 && '——每一句都聽過再存'}
          </span>
        ) : (
          <span className="text-[10px] leading-relaxed text-ink-600">
            它會轉錄整首歌，再把聽到的跟你的歌詞對齊。唱歌比講話難辨識，所以這是
            初稿，不是答案。
          </span>
        )}
      </div>

      {!live ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
          要先播放這一首才能打時間——時間碼是從正在播的位置取的。
          先按上面播放器的播放鍵。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60">
          <button
            type="button"
            onClick={player.toggle}
            aria-label={player.playing ? '暫停' : '播放'}
            className="tap grid size-7 place-items-center rounded-full bg-accent-600 text-white hover:bg-accent-500"
          >
            {player.playing ? (
              <Pause aria-hidden className="size-3.5" />
            ) : (
              <Play aria-hidden className="size-3.5" />
            )}
          </button>

          <span className="font-mono text-[12px] text-ink-100 tabular-nums">
            {formatLrcTime(player.current * 1000)}
          </span>

          <button
            type="button"
            onClick={onTap}
            className="bg-brand-gradient tap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white"
          >
            <Timer aria-hidden className="size-3.5" />
            蓋上這一句（空白鍵）
          </button>

          <button
            type="button"
            onClick={onReset}
            className="tap ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-ink-500 hover:bg-stage-800 hover:text-ink-100"
          >
            <RotateCcw aria-hidden className="size-3" />
            全部清掉重來
          </button>
        </div>
      )}

      {/*
        The tap target is the list itself, so space works wherever focus
        happens to be inside it — chasing a button with the keyboard while
        keeping time with the music is not a thing anybody can do.
      */}
      <div
        role="application"
        aria-label="打時間"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            onTap()
          }
        }}
        className="max-h-72 overflow-y-auto rounded-lg bg-stage-950/60 p-1.5 focus:ring-1 focus:ring-accent-600 focus:outline-none"
      >
        <ol className="flex flex-col gap-0.5">
          {lines.map((line, index) => (
            <li key={index} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPick(index)}
                className={cn(
                  'tap min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[12px] transition-colors',
                  index === cursor
                    ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                    : 'text-ink-400 hover:bg-stage-800'
                )}
              >
                {line.text || '（間奏）'}
              </button>

              {/*
                How the time got there, when it came from a proposal.
                「猜的」 is interpolated between neighbours; 「?」 matched too
                little to trust. Both are still shown — a flagged guess you
                can check beats a gap you have to find.
              */}
              {aligned?.[index] && line.timeMs !== null && (
                <span
                  className="shrink-0 text-[9px]"
                  title={
                    aligned[index]!.source === 'interpolated'
                      ? '這一句沒聽出來，時間是從前後兩句推的'
                      : `對上這一句 ${Math.round(aligned[index]!.confidence * 100)}% 的字`
                  }
                >
                  {aligned[index]!.source === 'interpolated' ? (
                    <span className="text-amber-400">猜</span>
                  ) : aligned[index]!.confidence < 0.5 ? (
                    <span className="text-amber-400">?</span>
                  ) : (
                    <span className="text-emerald-400">✓</span>
                  )}
                </span>
              )}

              <span
                className={cn(
                  'w-16 shrink-0 text-right font-mono text-[10px] tabular-nums',
                  line.timeMs === null ? 'text-ink-700' : 'text-accent-300'
                )}
              >
                {line.timeMs === null ? '—' : formatLrcTime(line.timeMs)}
              </span>

              <button
                type="button"
                onClick={() => onClear(index)}
                disabled={line.timeMs === null}
                aria-label="清掉這一句的時間"
                className="tap grid size-5 shrink-0 place-items-center rounded text-ink-600 hover:bg-stage-800 hover:text-rose-300 disabled:opacity-20"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[10px] leading-relaxed text-ink-600">
        點一句把它選起來，歌放到那一句時按空白鍵蓋上時間，游標會自己跳到下一句。
        點錯了按右邊的 × 清掉再來。順序不會變——不然下一句會從手指底下跑掉。
      </p>
    </div>
  )
}
