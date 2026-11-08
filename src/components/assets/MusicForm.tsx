'use client'

import { Loader2, Music, Upload, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useUploader } from '@/components/studio/useUploader'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { assetUrl } from '@/lib/asset-url'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'
import { cn, formatDurationZh } from '@/lib/utils'
import { GENRE_TAGS, MOOD_TAGS, suggestTags } from '@/lib/music-tags'

/**
 * 84 音樂新增／編輯 (Z6).
 *
 * Two steps on create, because they fail differently: the bytes go to R2
 * first, and only once they are there does the metadata get written. A track
 * registered against a half-finished upload would appear in the library and
 * refuse to play, which spec §2-84 rules out —「檔案未完成不可顯示可使用」.
 *
 * The licence row is created automatically, status 待確認. Uploading is not
 * licensing, and 88 reports on licences — a track with no row would be absent
 * from that report rather than flagged, which is how unlicensed music ships.
 */

export type MusicFormValues = {
  title: string
  category: string
  genreTags: string[]
  moodTags: string[]
  language: string
  artist: string
  bpm: number | null
  musicalKey: string
  sourcePlatform: string
  description: string
}

const CATEGORIES = [
  { value: 'OP', label: '片頭曲（OP）' },
  { value: 'ED', label: '片尾曲（ED）' },
  { value: 'BGM', label: '背景音樂（BGM）' },
  { value: 'INSERT', label: '插曲' },
  { value: 'CHARACTER_SONG', label: '角色曲' },
  { value: 'OTHER', label: '其他' },
]

const EMPTY: MusicFormValues = {
  title: '',
  category: 'BGM',
  genreTags: [],
  moodTags: [],
  language: '',
  artist: '',
  bpm: null,
  musicalKey: '',
  sourcePlatform: '',
  description: '',
}

/**
 * 一首歌最多掛幾個標籤。
 *
 * 原本寫死在三個地方（`commit`、建議膠囊的 `onClick` 與它的 `disabled`），改
 * 一個漏兩個的那種。
 */
const MAX_TAGS = 12

export function MusicForm({
  projectId,
  mode,
  assetId,
  initial,
  fileInfo,
  usedTags,
}: {
  projectId: string
  mode: 'create' | 'edit'
  /** Present when editing. */
  assetId?: string
  initial?: MusicFormValues
  /** Shown when editing, so the file being described is identifiable. */
  fileInfo?: { name: string; sizeBytes: number; durationSec: number | null; hasWaveform: boolean }
  /** Tags already used in this project, offered beside the presets (Z119). */
  usedTags?: { genre: string[]; mood: string[] }
}) {
  const router = useRouter()
  const toast = useToast()

  const [values, setValues] = useState<MusicFormValues>(initial ?? EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Create mode: the asset only exists once the file has landed. */
  const [uploaded, setUploaded] = useState<{
    assetId: string
    name: string
    durationSec: number | null
  } | null>(null)

  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploader = useUploader({
    projectId,
    onComplete: (id, file) => {
      /*
       * Duration comes from the browser, which has already decoded the file to
       * draw the waveform. The upload pipeline never decodes anything, so
       * without this the library would show every track as having no length.
       */
      void readDuration(file).then((durationSec) => {
        setUploaded({ assetId: id, name: file.name, durationSec })
        setValues((current) =>
          current.title ? current : { ...current, title: stripExtension(file.name) }
        )
      })
    },
  })

  const active = uploader.items.find((item) =>
    ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
  )
  const failed = uploader.items.find((item) => item.status === 'failed')

  const targetAssetId = mode === 'edit' ? assetId : uploaded?.assetId
  const ready = Boolean(targetAssetId) && values.title.trim().length > 0

  function accept(files: FileList | File[] | null) {
    setError(null)
    const file = Array.from(files ?? [])[0]
    if (!file) return

    // Resolved the same way the server does: a .flac the OS reports as
    // octet-stream is still a valid audio file.
    if (familyOf(resolveMimeType(file.name, file.type)) !== 'audio') {
      setError(`「${file.name}」不是音訊檔`)
      return
    }

    uploader.enqueue([file], 'MUSIC')
  }

  async function save() {
    if (!targetAssetId) return

    setSaving(true)
    setError(null)

    try {
      const body = {
        ...values,
        bpm: values.bpm,
        ...(mode === 'create'
          ? { assetId: targetAssetId, durationSec: uploaded?.durationSec ?? null }
          : {}),
      }

      const response = await apiFetch(
        mode === 'create'
          ? `/api/projects/${projectId}/assets/music`
          : `/api/projects/${projectId}/assets/music/${targetAssetId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(mode === 'create' ? '音樂已新增' : '資訊已更新', '授權狀態為待確認。')
      router.push(`/projects/${projectId}/assets`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {mode === 'create' && (
        <section
          onDragOver={(event: DragEvent<HTMLElement>) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent<HTMLElement>) => {
            event.preventDefault()
            setDragging(false)
            accept(event.dataTransfer.files)
          }}
          className={cn(
            'panel flex flex-col items-center gap-2 rounded-xl p-6 text-center ring-1 transition-colors',
            dragging ? 'bg-accent-600/10 ring-accent-500/60' : 'bg-stage-900 ring-stage-700'
          )}
        >
          {uploaded ? (
            <>
              <Music aria-hidden className="size-5 text-emerald-400" />
              <p className="text-xs text-ink-100">{uploaded.name}</p>
              <p className="text-[10px] text-ink-600">
                已上傳
                {uploaded.durationSec !== null &&
                  `・${formatDurationZh(Math.round(uploaded.durationSec))}`}
              </p>
              <audio
                src={assetUrl(uploaded.assetId)}
                controls
                preload="none"
                className="mt-1 h-8 w-full max-w-sm"
              />
            </>
          ) : active ? (
            <>
              <Loader2 aria-hidden className="size-5 animate-spin text-accent-400" />
              <p className="text-xs text-ink-300">
                上傳中 {Math.round(active.progress * 100)}%
              </p>
              <button
                type="button"
                onClick={() => void uploader.cancel(active.id)}
                className="text-[10px] text-ink-600 underline underline-offset-2 hover:text-ink-300"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <Music aria-hidden className="size-5 text-ink-700" />
              <p className="text-xs text-ink-300">先上傳音檔</p>
              <p className="text-[10px] leading-relaxed text-ink-600">
                MP3、WAV、FLAC、AAC、M4A、OGG、Opus 等格式都可以，也可以直接拖進來。
              </p>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Upload aria-hidden className="size-3.5" />}
                onClick={() => inputRef.current?.click()}
              >
                選擇音檔
              </Button>
            </>
          )}

          {failed && (
            <p role="alert" className="text-[10px] text-rose-400">
              上傳失敗：{failed.error}{' '}
              <button
                type="button"
                onClick={() => uploader.retry(failed.id)}
                className="underline underline-offset-2"
              >
                重試
              </button>
            </p>
          )}
        </section>
      )}

      {mode === 'edit' && fileInfo && (
        <section className="panel flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-stage-900 p-3 text-[11px] ring-1 ring-stage-700">
          <Music aria-hidden className="size-3.5 text-accent-400" />
          <span className="text-ink-200">{fileInfo.name}</span>
          <span className="text-ink-600">{formatBytes(fileInfo.sizeBytes)}</span>
          {fileInfo.durationSec !== null && (
            <span className="text-ink-600">{formatDurationZh(fileInfo.durationSec)}</span>
          )}
          {!fileInfo.hasWaveform && <span className="text-ink-700">尚未計算波形</span>}
          {assetId && (
            <audio
              src={assetUrl(assetId)}
              controls
              preload="none"
              className="ml-auto h-8 w-full max-w-xs"
            />
          )}
        </section>
      )}

      <section className="panel flex flex-col gap-4 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
        <Field label="曲名" required>
          <Input
            value={values.title}
            maxLength={120}
            onChange={(event) => setValues({ ...values, title: event.target.value })}
            placeholder="例如：《一灶見山河》主題曲"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="類型 / 用途" required>
            <Select
              value={values.category}
              options={CATEGORIES}
              onChange={(event) => setValues({ ...values, category: event.target.value })}
            />
          </Field>

          <Field label="演唱者 / 製作者">
            <Input
              value={values.artist}
              maxLength={120}
              onChange={(event) => setValues({ ...values, artist: event.target.value })}
            />
          </Field>
        </div>

        <TagField
          label="風格標籤"
          hint="點就加上去，沒有的直接打，按 Enter 建立"
          values={values.genreTags}
          suggestions={suggestTags(GENRE_TAGS, usedTags?.genre ?? [])}
          onChange={(genreTags) => setValues({ ...values, genreTags })}
        />

        <TagField
          label="情緒氛圍"
          hint="點就加上去，沒有的直接打，按 Enter 建立"
          values={values.moodTags}
          suggestions={suggestTags(MOOD_TAGS, usedTags?.mood ?? [])}
          onChange={(moodTags) => setValues({ ...values, moodTags })}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="語言">
            <Input
              value={values.language}
              maxLength={40}
              onChange={(event) => setValues({ ...values, language: event.target.value })}
              placeholder="國語 / 演奏曲"
            />
          </Field>

          <Field label="BPM" description="不確定就留空。">
            <Input
              type="number"
              value={values.bpm ?? ''}
              min={20}
              max={400}
              onChange={(event) =>
                setValues({
                  ...values,
                  // Empty means unknown, not zero — zero would be a wrong
                  // number in a filter rather than an absent one.
                  bpm: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </Field>

          <Field label="調性">
            <Input
              value={values.musicalKey}
              maxLength={20}
              onChange={(event) => setValues({ ...values, musicalKey: event.target.value })}
              placeholder="C / Am"
            />
          </Field>
        </div>

        <Field
          label="來源平台"
          description="自製錄音、商用音效庫、授權音樂，或 AI 生成的平台名稱。授權細節在「授權管理」補。"
        >
          <Input
            value={values.sourcePlatform}
            maxLength={80}
            onChange={(event) => setValues({ ...values, sourcePlatform: event.target.value })}
          />
        </Field>

        <Field label="簡介">
          <Textarea
            value={values.description}
            rows={3}
            maxLength={2000}
            onChange={(event) => setValues({ ...values, description: event.target.value })}
          />
        </Field>

        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300 ring-1 ring-inset ring-amber-500/30">
          新增的音樂授權狀態一律是「待確認」。上傳不等於取得授權，
          也不會因為是用訂閱方案產生的就自動歸屬——要到「授權管理」補上來源與條款證據才會轉成已授權。
        </p>

        {error && (
          <p role="alert" className="text-[11px] text-rose-400">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}/assets`)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            loading={saving}
            loadingText="儲存中…"
            disabled={!ready}
          >
            {mode === 'create' ? '新增音樂' : '儲存'}
          </Button>
        </div>

        {mode === 'create' && !uploaded && (
          <p className="text-right text-[10px] text-ink-700">上傳音檔之後才能儲存。</p>
        )}
      </section>

      <input
        ref={inputRef}
        type="file"
        accept={acceptFor('audio')}
        className="hidden"
        onChange={(event) => {
          accept(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/** Free-form tags. Enter or comma commits one; backspace on an empty box removes the last. */
function TagField({
  label,
  hint,
  values,
  suggestions = [],
  onChange,
}: {
  label: string
  hint: string
  values: string[]
  /** Click to add. Typing still works for anything not on the list. */
  suggestions?: string[]
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  /** 加不進去的理由。`null` 是沒事，不是「還沒檢查」。 */
  const [problem, setProblem] = useState<string | null>(null)
  const unused = suggestions.filter((tag) => !values.includes(tag))

  /**
   * 加一個標籤，而**加不進去的時候不要把人家打的字吃掉** (Z196).
   *
   * 原本是先 `setDraft('')` 再判斷，所以打一個已經有的標籤、或第 13 個，按下
   * Enter（或只是移開焦點，因為 `onBlur` 也走這裡）就是：輸入框清空、什麼都
   * 沒加、也沒有任何訊息。而欄位的提示寫的正好相反——「沒有的直接打，按
   * Enter 建立」。
   *
   * 現在只有真的加進去了才清空。12 個的上限畫面上本來也從沒說過。
   */
  function commit() {
    const tag = draft.trim()
    if (!tag) {
      // 空白不是錯誤，只是沒事做——順手把殘留的空白清掉。
      setDraft('')
      setProblem(null)
      return
    }
    if (values.includes(tag)) {
      setProblem(`「${tag}」已經在上面了`)
      return
    }
    if (values.length >= MAX_TAGS) {
      setProblem(`最多 ${MAX_TAGS} 個，要再加就先移掉一個`)
      return
    }
    onChange([...values, tag])
    setDraft('')
    setProblem(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <Field label={label} description={hint}>
      <div className="flex flex-wrap items-center gap-1 rounded-md bg-stage-900 p-1.5 ring-1 ring-inset ring-stage-700 focus-within:ring-2 focus-within:ring-accent-500">
        {values.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded bg-stage-800 px-1.5 py-0.5 text-[11px] text-ink-200"
          >
            {tag}
            <button
              type="button"
              aria-label={`移除 ${tag}`}
              onClick={() => onChange(values.filter((value) => value !== tag))}
              className="text-ink-600 hover:text-rose-300"
            >
              <X aria-hidden className="size-2.5" />
            </button>
          </span>
        ))}

        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            // 一開始改就把上一次的理由收掉——留著它會在描述已經不成立之後
            // 還指著輸入框說它有問題。
            if (problem) setProblem(null)
          }}
          onKeyDown={onKeyDown}
          onBlur={commit}
          maxLength={24}
          placeholder={values.length === 0 ? '輸入後按 Enter' : ''}
          className="min-w-24 flex-1 bg-transparent px-1 text-xs text-ink-50 placeholder:text-ink-600 focus:outline-none"
        />

        <span className="shrink-0 px-1 text-[10px] text-ink-600 tabular-nums">
          {values.length}/{MAX_TAGS}
        </span>
      </div>

      {problem && (
        <p role="status" className="mt-1 text-[11px] text-amber-300">
          {problem}
        </p>
      )}

      {/*
        按的那一排 (Z119).

        Only the ones not already chosen, so the row shrinks as you pick —
        a suggestion you have taken is no longer a suggestion, and leaving it
        there invites a click that does nothing.
      */}
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {unused.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => {
                if (values.length >= MAX_TAGS) return
                onChange([...values, tag])
              }}
              disabled={values.length >= MAX_TAGS}
              // 灰掉的按鈕要說得出為什麼灰（spec v2 §4）。
              title={values.length >= MAX_TAGS ? `最多 ${MAX_TAGS} 個標籤` : undefined}
              className="tap rounded-full bg-stage-850 px-2 py-0.5 text-[10px] text-ink-400 ring-1 ring-stage-700 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
            >
              ＋{tag}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

/**
 * The track's length, read in the browser.
 *
 * The upload pipeline never decodes a file, so without this every track would
 * be stored with no duration — and a music library that cannot tell you how
 * long anything is fails at its first job.
 */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()

    const done = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }

    audio.preload = 'metadata'
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? audio.duration : null)
    audio.onerror = () => done(null)
    // A codec the browser cannot decode must not hang the form.
    setTimeout(() => done(null), 10_000)

    audio.src = url
  })
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]{1,12}$/, '')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
