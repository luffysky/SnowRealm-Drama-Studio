'use client'

import { Download, FileUp, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { FILENAME_KEYWORDS } from '@/lib/import/filename'
import { FORMAT_LABEL, type ImportFormat } from '@/lib/import/parse'
import { SHEET_FORMAT_LABEL, type SheetFormat } from '@/lib/import/sheet-format'
import { detectMapping } from '@/lib/import/map'
import { IMPORT_TARGETS, importTarget, type ImportTargetKey } from '@/lib/import/targets'
import { cn } from '@/lib/utils'

/**
 * 匯入：一次很多個檔案，先看清楚再寫 (Z185).
 *
 * ## 三步，而中間那一步是重點
 *
 * 丟檔案 → **看對應與問題** → 確認匯入。自動對應會猜錯，而猜錯的後果是把台詞
 * 存進「誰說的」——它不報錯，要到配音的時候才有人發現。所以對應一定要攤開
 * 讓人改，而不是「偵測到了，幫你匯好了」。
 *
 * ## 每個檔案自己一組
 *
 * 檔名決定它是哪一區的（`filenameGuide()` 是那份規格），而認不出來的不會亂
 * 猜——那一個會留一個「這是什麼」的下拉等人選。二十個檔案裡有十九個認得出
 * 來，剩下一個要選，比二十個都要選好得多。
 */

export type ImportEpisodeOption = { id: string; number: number; title: string }

type PreviewIssue = { row: number; field: string; message: string; level: 'warning' | 'error' }

type PreviewFile = {
  filename: string
  error?: string
  /** `document` 是小說那一種：一份 Markdown，不是表格。 */
  mode?: 'document'
  docText?: string
  episode?: { title: string; logline: string; synopsis: string }
  chapters?: { title: string; chars: number }[]
  note?: string
  sheet?: { headers: string[]; rows: string[][]; format: string }
  encoding?: string
  encodingNote?: string | null
  target?: ImportTargetKey | null
  matched?: string | null
  episodeNumber?: number | null
  mapping?: (string | null)[]
  unmapped?: string[]
  counts?: { ready: number; skipped: number }
  issues?: PreviewIssue[]
  newVocabulary?: { kind: string; value: string; label: string }[]
  needsTarget?: boolean
}

type FileState = PreviewFile & {
  /** 使用者改過的區塊與對應。 */
  chosenTarget: ImportTargetKey | null
  chosenMapping: (string | null)[]
  episodeId: string | null
  done?: { created: number; updated: number; skipped: number }
}

export function ImportDialog({
  projectId,
  episodes,
  defaultTarget = null,
  defaultEpisodeId = null,
  onClose,
}: {
  projectId: string
  episodes: ImportEpisodeOption[]
  /** 從某一頁打開時預設匯入哪一區（檔名認得出來的話以檔名為準）。 */
  defaultTarget?: ImportTargetKey | null
  defaultEpisodeId?: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<FileState[]>([])
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function preview(picked: File[], text: string) {
    if (picked.length === 0 && !text.trim()) return
    setBusy(true)
    try {
      const form = new FormData()
      for (const file of picked) form.append('files', file)
      if (text.trim()) form.append('text', text)
      /*
       * 把「這一頁預設匯入哪一區」送過去 (Z190).
       *
       * 漏掉這一個的後果是整條功能**靜靜地不做事**：伺服器端只剩檔名猜測，
       * 所以貼上的內容（來源名字是「貼上的內容」）與檔名不含關鍵字的檔案都
       * 認不出區塊 → 不回 `mapping` → 用戶端補成空陣列 → 每一欄都是「不匯
       * 入」→ 按下匯入，每一列都被當空白列跳過 → 「已匯入 0 筆」。
       *
       * 沒有錯誤訊息，因為確實沒有出錯。
       */
      if (defaultTarget) form.append('target', defaultTarget)

      const response = await apiFetch(`/api/projects/${projectId}/import/preview`, {
        method: 'POST',
        body: form,
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { files: PreviewFile[] }
      setFiles((current) => [
        ...current,
        ...body.files.map((file) => {
          const chosenTarget = file.target ?? defaultTarget
          return {
            ...file,
            chosenTarget,
            /*
             * 伺服器沒給對應（它認不出區塊）而我們知道是哪一區時，在這裡補
             * 算一次——`detectMapping` 是純函式，用戶端跑得了。少了這一步，
             * 那個檔案的每一欄都會停在「不匯入」。
             */
            chosenMapping:
              file.mapping ??
              (chosenTarget && file.sheet
                ? detectMapping(file.sheet.headers, importTarget(chosenTarget))
                : []),
            episodeId: episodeFor(file),
          }
        }),
      ])
      setPasted('')
    } catch (cause) {
      toast.error('讀不進來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  /** 檔名寫了第幾集就用那一集，否則用打開時那一集。 */
  function episodeFor(file: PreviewFile): string | null {
    if (file.episodeNumber) {
      const hit = episodes.find((episode) => episode.number === file.episodeNumber)
      if (hit) return hit.id
    }
    return defaultEpisodeId
  }

  async function importAll() {
    const ready = files.filter(
      (file) => (file.sheet || file.mode === 'document') && file.chosenTarget && !file.done
    )
    if (ready.length === 0) return

    setBusy(true)
    let created = 0
    let failed = 0

    for (const file of ready) {
      const definition = importTarget(file.chosenTarget!)
      if (definition.scope === 'episode' && !file.episodeId) {
        toast.error(`「${file.filename}」還沒選集數`, '這一種匯入要指定匯到哪一集。')
        failed += 1
        continue
      }

      try {
        const response = await apiFetch(`/api/projects/${projectId}/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            file.mode === 'document'
              ? {
                  target: file.chosenTarget,
                  episodeId: file.episodeId,
                  docText: file.docText,
                }
              : {
                  target: file.chosenTarget,
                  episodeId: file.episodeId,
                  mapping: file.chosenMapping,
                  sheet: file.sheet,
                }
          ),
        })
        if (!response.ok) throw new Error(await readApiError(response))

        const body = (await response.json()) as {
          created: number
          updated: number
          skipped: number
          addedOptions: { label: string }[]
          notes: string[]
        }
        created += body.created + body.updated
        setFiles((current) =>
          current.map((item) =>
            item === file
              ? { ...item, done: { created: body.created, updated: body.updated, skipped: body.skipped } }
              : item
          )
        )
        if (body.addedOptions.length > 0) {
          toast.success(
            '順手新增了下拉選項',
            body.addedOptions.map((option) => option.label).join('、')
          )
        }
        for (const note of body.notes) toast.success(file.filename, note)
      } catch (cause) {
        failed += 1
        toast.error(`「${file.filename}」匯入失敗`, cause instanceof Error ? cause.message : undefined)
      }
    }

    setBusy(false)
    if (created > 0) {
      toast.success(`匯入了 ${created} 筆`, failed > 0 ? `有 ${failed} 個檔案失敗。` : undefined)
      router.refresh()
    }
  }

  const pending = files.filter((file) => (file.sheet || file.mode === 'document') && !file.done)
  const canImport = pending.length > 0 && pending.every((file) => file.chosenTarget)

  return (
    <Dialog
      open
      size="xl"
      onRequestClose={() => {
        if (!busy) onClose()
      }}
      title="匯入資料"
      description="可以一次丟很多個檔案。檔名會決定每一個是給哪一區的，認不出來的讓你自己選。"
      busy={busy}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <TemplateLinks />
            <ExportLinks
              projectId={projectId}
              episodes={episodes}
              defaultEpisodeId={defaultEpisodeId}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              關閉
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void importAll()}
              disabled={!canImport || busy}
              loading={busy}
              loadingText="匯入中…"
            >
              匯入 {pending.length > 0 ? `${pending.length} 個檔案` : ''}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div
          onDragOver={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault()
            setDragging(false)
            void preview(Array.from(event.dataTransfer.files), '')
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-accent-500 bg-accent-600/10' : 'border-stage-700'
          )}
        >
          <FileUp aria-hidden className="size-5 text-ink-600" />
          <p className="text-[11px] text-ink-400">
            把檔案拖進來，或
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mx-1 underline underline-offset-2 hover:text-ink-100"
            >
              選擇檔案
            </button>
          </p>
          <p className="text-[10px] text-ink-600">
            CSV、TSV、TXT、JSON、JSONL、Markdown 表格、HTML 表格、Excel。
            編碼建議 UTF-8，Big5／GBK 也讀得進來。
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.json,.jsonl,.md,.markdown,.html,.htm,.xlsx"
            onChange={(event) => {
              void preview(Array.from(event.target.files ?? []), '')
              event.target.value = ''
            }}
            className="hidden"
          />
        </div>

        <details className="rounded-lg bg-stage-900/60 px-3 py-2 ring-1 ring-stage-700">
          <summary className="cursor-pointer text-[11px] text-ink-400">
            或直接貼上（從 Excel／Google 試算表複製的表格就可以）
          </summary>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={4}
            placeholder="貼在這裡，然後按下面那顆"
            className="mt-2 w-full rounded-md bg-stage-950 px-2 py-1.5 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!pasted.trim() || busy}
            onClick={() => void preview([], pasted)}
          >
            讀這段
          </Button>
        </details>

        {files.length === 0 ? null : (
          <ul className="flex flex-col gap-2">
            {files.map((file, index) => (
              <li key={`${file.filename}-${index}`}>
                <FileCard
                  file={file}
                  episodes={episodes}
                  onChange={(next) =>
                    setFiles((current) => current.map((item, i) => (i === index ? next : item)))
                  }
                  onRetarget={(target) =>
                    setFiles((current) =>
                      current.map((item, i) => (i === index ? retarget(item, target) : item))
                    )
                  }
                  onRemove={() =>
                    setFiles((current) => current.filter((_, i) => i !== index))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

function TemplateLinks() {
  const [target, setTarget] = useState<ImportTargetKey>('shots')
  const definition = importTarget(target)
  const keyword = FILENAME_KEYWORDS[target][0]
  const example =
    definition.scope === 'episode' ? `${keyword}-EP001.csv` : `${keyword}.csv`

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-500">
      <Download aria-hidden className="size-3" />
      範本
      <select
        value={target}
        onChange={(event) => setTarget(event.target.value as ImportTargetKey)}
        className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-200 ring-1 ring-inset ring-stage-700"
      >
        {IMPORT_TARGETS.map((item) => (
          <option key={item.key} value={item.key} className="bg-stage-850">
            {item.label}
          </option>
        ))}
      </select>
      {(
        [
          ['CSV', `/api/import/template?target=${target}&format=csv`],
          ['JSON', `/api/import/template?target=${target}&format=json`],
          ['欄位說明', `/api/import/template?kind=guide&target=${target}`],
          ['檔名規格', `/api/import/template?kind=filenames`],
        ] as const
      ).map(([label, href]) => (
        <a
          key={label}
          href={href}
          className="rounded bg-stage-850 px-1.5 py-0.5 ring-1 ring-stage-700 transition-colors hover:text-ink-100"
        >
          {label}
        </a>
      ))}
      {/*
        把建議檔名直接寫出來。規格文件裡也有，但「下載完要照什麼命名」是下載
        當下才會想到的事——寫在旁邊省掉一次來回。
      */}
      <span className="text-ink-700">檔名：{example}</span>
    </div>
  )
}

/**
 * 把現況倒出來。
 *
 * 跟匯入放同一個對話框，因為它們是同一件事的兩頭：倒出來改一改再匯回去，或
 * 把倒出來的檔案貼給模型當「現在長這樣」。分成兩個地方的話，第二個永遠比較
 * 難找。
 */
function ExportLinks({
  projectId,
  episodes,
  defaultEpisodeId,
}: {
  projectId: string
  episodes: ImportEpisodeOption[]
  defaultEpisodeId: string | null
}) {
  const [target, setTarget] = useState<ImportTargetKey>('shots')
  const [episodeId, setEpisodeId] = useState<string | null>(defaultEpisodeId)
  const [script, setScript] = useState<'original' | 'traditional' | 'simplified'>('original')
  const definition = importTarget(target)
  const needsEpisode = definition.scope === 'episode'
  const ready = !needsEpisode || Boolean(episodeId)

  const href = (format: string) =>
    `/api/projects/${projectId}/export?target=${target}&format=${format}&script=${script}` +
    (needsEpisode && episodeId ? `&episodeId=${episodeId}` : '')

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-500">
      <Download aria-hidden className="size-3 rotate-180" />
      匯出現況
      <select
        value={target}
        onChange={(event) => setTarget(event.target.value as ImportTargetKey)}
        className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-200 ring-1 ring-inset ring-stage-700"
      >
        {IMPORT_TARGETS.map((item) => (
          <option key={item.key} value={item.key} className="bg-stage-850">
            {item.label}
          </option>
        ))}
      </select>

      {needsEpisode && (
        <select
          value={episodeId ?? ''}
          onChange={(event) => setEpisodeId(event.target.value || null)}
          className="h-6 max-w-32 rounded bg-stage-850 px-1 text-[10px] text-ink-200 ring-1 ring-inset ring-stage-700"
        >
          <option value="" className="bg-stage-850">
            選一集
          </option>
          {episodes.map((episode) => (
            <option key={episode.id} value={episode.id} className="bg-stage-850">
              EP{String(episode.number).padStart(3, '0')}
            </option>
          ))}
        </select>
      )}

      {/*
        字形。預設「原文」是刻意的：**轉過的檔案再匯回來，會把轉換結果存進資
        料庫**，而簡 → 繁 是一對多、轉不回去的。要拿去改再匯回來就選原文；要
        給人看再選。
      */}
      <select
        value={script}
        onChange={(event) => setScript(event.target.value as 'original')}
        title="轉過字形的檔案再匯回來，會把轉換結果存進資料庫——要改再匯回來的話選原文"
        className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-200 ring-1 ring-inset ring-stage-700"
      >
        <option value="original" className="bg-stage-850">原文</option>
        <option value="traditional" className="bg-stage-850">繁體</option>
        <option value="simplified" className="bg-stage-850">简体</option>
      </select>

      {(['csv', 'json', 'markdown'] as const).map((format) => (
        <a
          key={format}
          href={ready ? href(format) : undefined}
          aria-disabled={!ready}
          className={cn(
            'rounded px-1.5 py-0.5 ring-1 ring-stage-700 transition-colors',
            ready ? 'bg-stage-850 hover:text-ink-100' : 'cursor-not-allowed opacity-40'
          )}
          title={ready ? undefined : '先選一集'}
        >
          {SHEET_FORMAT_LABEL[format as SheetFormat].split('（')[0]}
        </a>
      ))}

      {/*
        PDF 走**另開一頁的列印檢視**，不是在這裡呼叫 `window.print()`——那會
        印到這個對話框本身，印出來是一張有下拉選單的圖。
        
        用瀏覽器的列印引擎而不是在伺服器端產 PDF：中文 PDF 要嵌字型，自己做
        要扛一份幾 MB 的字型檔，而換來的是比較差的排版。
      */}
      <a
        href={
          ready
            ? `/projects/${projectId}/print?target=${target}` +
              (needsEpisode && episodeId ? `&episodeId=${episodeId}` : '')
            : undefined
        }
        target="_blank"
        rel="noopener"
        aria-disabled={!ready}
        className={cn(
          'rounded px-1.5 py-0.5 ring-1 ring-stage-700 transition-colors',
          ready ? 'bg-stage-850 hover:text-ink-100' : 'cursor-not-allowed opacity-40'
        )}
        title="開一頁乾淨的版面，用瀏覽器列印成 PDF"
      >
        PDF
      </a>
    </div>
  )
}

/**
 * 換了「這是什麼」就重算欄位對應 (Z190).
 *
 * 不重算的話，畫面上那組「可匯入 N 列、M 列不會匯入」是**在說舊區塊的
 * 話**。大部分組合會因為欄位名完全不重疊而全部報必填錯誤（吵，但看得出
 * 來）；而剛好有同名欄位的兩個區塊（集數大綱 → 任務，兩邊都有「標題」與
 * 「狀態」）會無聲地建出一堆只有標題的東西。
 *
 * 只重算對應，不重算問題清單——那要再打一次伺服器，而使用者按下匯入時本來
 * 就會重算一次。所以舊的計數先清掉，不要留一個會說謊的數字在畫面上。
 */
function retarget(file: FileState, target: ImportTargetKey | null): FileState {
  if (!target || !file.sheet) {
    return { ...file, chosenTarget: target, chosenMapping: [], counts: undefined, issues: [] }
  }
  return {
    ...file,
    chosenTarget: target,
    chosenMapping: detectMapping(file.sheet.headers, importTarget(target)),
    counts: undefined,
    issues: [],
    unmapped: undefined,
    newVocabulary: undefined,
  }
}

function FileCard({
  file,
  episodes,
  onChange,
  onRetarget,
  onRemove,
}: {
  file: FileState
  episodes: ImportEpisodeOption[]
  onChange: (next: FileState) => void
  onRetarget: (target: ImportTargetKey | null) => void
  onRemove: () => void
}) {
  if (file.error) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 ring-1 ring-rose-500/30">
        <span className="min-w-0 flex-1 truncate">{file.filename}</span>
        <span>{file.error}</span>
        <button type="button" onClick={onRemove} aria-label="移除">
          <X aria-hidden className="size-3" />
        </button>
      </div>
    )
  }

  const definition = file.chosenTarget ? importTarget(file.chosenTarget) : null
  const errors = (file.issues ?? []).filter((issue) => issue.level === 'error')
  const warnings = (file.issues ?? []).filter((issue) => issue.level === 'warning')

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-stage-900/60 px-3 py-2.5 ring-1 ring-stage-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-200">{file.filename}</span>

        {file.done ? (
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
            已匯入 {file.done.created + file.done.updated} 筆
          </span>
        ) : (
          <>
            <Select
              value={file.chosenTarget ?? ''}
              onChange={(event) =>
                onRetarget((event.target.value || null) as ImportTargetKey)
              }
              className="h-7 w-36 text-[11px]"
              placeholder="這是什麼？"
              options={IMPORT_TARGETS.map((item) => ({ value: item.key, label: item.label }))}
            />
            {definition?.scope === 'episode' && (
              <Select
                value={file.episodeId ?? ''}
                onChange={(event) => onChange({ ...file, episodeId: event.target.value || null })}
                className="h-7 w-40 text-[11px]"
                placeholder="匯到哪一集？"
                options={episodes.map((episode) => ({
                  value: episode.id,
                  label: `EP${String(episode.number).padStart(3, '0')} ${episode.title}`,
                }))}
              />
            )}
          </>
        )}

        <button type="button" onClick={onRemove} aria-label={`移除「${file.filename}」`}>
          <X aria-hidden className="size-3 text-ink-600 hover:text-rose-300" />
        </button>
      </div>

      {file.mode === 'document' && (
        <div className="flex flex-col gap-1 rounded-lg bg-stage-950/60 px-2.5 py-2 text-[10px] ring-1 ring-stage-700">
          <p className="text-ink-500">{file.note}</p>
          {file.episode && (
            <dl className="flex flex-col gap-0.5">
              {([
                ['標題', file.episode.title],
                ['一句話', file.episode.logline],
                ['大綱', file.episode.synopsis],
              ] as const).map(([label, value]) =>
                value ? (
                  <div key={label} className="flex gap-1.5">
                    <dt className="shrink-0 text-ink-600">{label}</dt>
                    <dd className="min-w-0 flex-1 truncate text-ink-300">{value}</dd>
                  </div>
                ) : null
              )}
            </dl>
          )}
          {file.chapters && (
            <ul className="flex flex-wrap gap-1">
              {file.chapters.map((chapter, i) => (
                <li key={i} className="rounded bg-stage-850 px-1.5 py-0.5 text-ink-400">
                  {chapter.title || `第 ${i + 1} 章`}・{chapter.chars.toLocaleString('en-US')} 字
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-700">
            集數的標題／一句話／大綱原本就有值的話不會被覆蓋。
          </p>
        </div>
      )}

      <p className="flex flex-wrap gap-x-3 text-[10px] text-ink-600">
        <span>
          {file.mode === 'document'
            ? `${file.chapters?.length ?? 0} 章`
            : `${file.sheet?.rows.length ?? 0} 列`}
        </span>
        <span>{file.sheet ? FORMAT_LABEL[file.sheet.format as ImportFormat] : ''}</span>
        <span>{file.encoding}</span>
        {file.matched && <span>檔名認出「{file.matched}」</span>}
        {file.counts && (
          <span>
            可匯入 {file.counts.ready}
            {file.counts.skipped > 0 && `，跳過 ${file.counts.skipped}`}
          </span>
        )}
      </p>

      {file.encodingNote && (
        <p className="text-[10px] text-amber-300">{file.encodingNote}</p>
      )}

      {definition && file.sheet && !file.done && (
        <div className="flex flex-wrap gap-1.5">
          {file.sheet.headers.map((header, column) => (
            <label key={`${header}-${column}`} className="flex items-center gap-1">
              <span className="max-w-24 truncate text-[10px] text-ink-500" title={header}>
                {header}
              </span>
              <span aria-hidden className="text-[10px] text-ink-700">
                →
              </span>
              <select
                value={file.chosenMapping[column] ?? ''}
                onChange={(event) => {
                  const next = [...file.chosenMapping]
                  next[column] = event.target.value || null
                  onChange({ ...file, chosenMapping: next })
                }}
                className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-200 ring-1 ring-inset ring-stage-700"
              >
                <option value="" className="bg-stage-850">
                  不匯入
                </option>
                {definition.fields.map((field) => (
                  <option key={field.key} value={field.key} className="bg-stage-850">
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {file.unmapped && file.unmapped.length > 0 && !file.done && (
        <p className="text-[10px] text-ink-600">沒有對到的欄位：{file.unmapped.join('、')}</p>
      )}

      {file.newVocabulary && file.newVocabulary.length > 0 && !file.done && (
        <p className="text-[10px] text-accent-300">
          會新增下拉選項：{file.newVocabulary.map((item) => item.label).join('、')}
        </p>
      )}

      {(errors.length > 0 || warnings.length > 0) && !file.done && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-ink-500">
            {errors.length > 0 && <span className="text-rose-300">{errors.length} 列不會匯入</span>}
            {errors.length > 0 && warnings.length > 0 && '，'}
            {warnings.length > 0 && <span className="text-amber-300">{warnings.length} 個提醒</span>}
          </summary>
          <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {[...errors, ...warnings].slice(0, 60).map((issue, i) => (
              <li
                key={i}
                className={issue.level === 'error' ? 'text-rose-300' : 'text-amber-200/80'}
              >
                第 {issue.row} 列・{issue.field}：{issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
