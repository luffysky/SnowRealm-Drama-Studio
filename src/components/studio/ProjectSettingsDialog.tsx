'use client'

import { ImageUp, Loader2, Settings2, Trash2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type DragEvent } from 'react'
import { ImagePicker } from '@/components/studio/ImagePicker'
import { useUploader } from '@/components/studio/useUploader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  type ProjectStatusValue,
} from '@/lib/constants'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'
import { cn } from '@/lib/utils'
import { assetPreviewUrl } from '@/lib/asset-url'

/**
 * 作品設定: the cover image and the three names.
 *
 * Two things the workspace header previously only promised:
 *
 * 1. **A cover that can be uploaded and replaced.** The bytes go straight from
 *    the browser to R2 through a presigned URL; the row stores an asset id,
 *    never a URL, because a presigned URL expires and the bucket stays
 *    private. The image is read back through `/api/files/[assetId]`.
 * 2. **Separate novel and drama names.** One production, two products: the
 *    novel is published under one title and the short drama released under
 *    another. Either field left empty means「與作品名稱相同」, which is stored
 *    as an empty string rather than a copy — a copy would quietly stop
 *    following the work's name when it was renamed.
 */

export type ProjectSettings = {
  id: string
  title: string
  /** Empty = same as `title`. */
  novelTitle: string
  dramaTitle: string
  logline: string
  synopsis: string
  tags: string[]
  status: ProjectStatusValue
  targetMinSec: number
  targetMaxSec: number
  targetChars: number
  coverAssetId: string | null
  /** 小說封面. Empty means「沿用作品封面」. */
  novelCoverAssetId: string | null
}

export function ProjectSettingsDialog({
  project,
  canWrite,
}: {
  project: ProjectSettings
  canWrite: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!canWrite) {
    return (
      <span
        aria-disabled="true"
        title="你的角色沒有編輯作品設定的權限"
        className="inline-flex h-7 cursor-default items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-700 select-none"
      >
        <Settings2 aria-hidden className="size-3.5" />
        作品設定
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100"
      >
        <Settings2 aria-hidden className="size-3.5" />
        作品設定
      </button>

      {/* Keyed so each opening starts from the saved values, not the last edit. */}
      {open && <SettingsForm key={project.coverAssetId ?? 'none'} project={project} onClose={() => setOpen(false)} />}
    </>
  )
}

function SettingsForm({
  project,
  onClose,
}: {
  project: ProjectSettings
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [title, setTitle] = useState(project.title)
  const [novelTitle, setNovelTitle] = useState(project.novelTitle)
  const [dramaTitle, setDramaTitle] = useState(project.dramaTitle)
  const [logline, setLogline] = useState(project.logline)
  const [synopsis, setSynopsis] = useState(project.synopsis)
  // Edited as one line of text, the same way the create form takes it.
  const [tagText, setTagText] = useState(project.tags.join(' '))
  const [status, setStatus] = useState<ProjectStatusValue>(project.status)
  const [targetMinSec, setTargetMinSec] = useState(String(project.targetMinSec))
  const [targetMaxSec, setTargetMaxSec] = useState(String(project.targetMaxSec))
  const [targetChars, setTargetChars] = useState(String(project.targetChars))
  const [coverAssetId, setCoverAssetId] = useState(project.coverAssetId)
  const [novelCoverAssetId, setNovelCoverAssetId] = useState(project.novelCoverAssetId)

  const tags = tagText
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    title !== project.title ||
    novelTitle !== project.novelTitle ||
    dramaTitle !== project.dramaTitle ||
    logline !== project.logline ||
    synopsis !== project.synopsis ||
    tags.join(' ') !== project.tags.join(' ') ||
    status !== project.status ||
    Number(targetMinSec) !== project.targetMinSec ||
    Number(targetMaxSec) !== project.targetMaxSec ||
    Number(targetChars) !== project.targetChars ||
    coverAssetId !== project.coverAssetId ||
    novelCoverAssetId !== project.novelCoverAssetId

  async function save() {
    if (!title.trim()) {
      setError('作品名稱不能空白')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await apiFetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          novelTitle: novelTitle.trim(),
          dramaTitle: dramaTitle.trim(),
          logline: logline.trim(),
          synopsis: synopsis.trim(),
          tags,
          status,
          targetMinSec: Number(targetMinSec) || 120,
          targetMaxSec: Number(targetMaxSec) || 180,
          targetChars: Number(targetChars) || 4000,
          coverAssetId,
          novelCoverAssetId,
        }),
      })

      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('作品設定已儲存')
      // The header, the cards and the page titles are all rendered on the
      // server from this row.
      router.refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onRequestClose={() => {
        if (saving) return
        onClose()
      }}
      title="作品設定"
      description="封面、名稱、簡介、類型、狀態與片長——新增作品填過的都在這裡改。"
      busy={saving}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-[11px] text-ink-600">
            {dirty ? '有未儲存的變更' : '沒有變更'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void save()}
              loading={saving}
              loadingText="儲存中…"
              disabled={!dirty}
            >
              儲存
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <CoverPicker
          projectId={project.id}
          coverAssetId={coverAssetId}
          savedCoverAssetId={project.coverAssetId}
          onChange={setCoverAssetId}
        />

        <Field
          label="作品名稱"
          required
          description="工作室內部對這部作品的稱呼，也是列表與麵包屑顯示的名字。"
        >
          <Input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：一灶見山河"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="小說書名"
            description="留空＝與作品名稱相同。"
            hint={<span className="text-[10px] text-ink-600">選填</span>}
          >
            <Input
              value={novelTitle}
              maxLength={120}
              onChange={(event) => setNovelTitle(event.target.value)}
              placeholder={title || '與作品名稱相同'}
            />
          </Field>

          <Field
            label="短劇劇名"
            description="留空＝與作品名稱相同。"
            hint={<span className="text-[10px] text-ink-600">選填</span>}
          >
            <Input
              value={dramaTitle}
              maxLength={120}
              onChange={(event) => setDramaTitle(event.target.value)}
              placeholder={title || '與作品名稱相同'}
            />
          </Field>
        </div>

        <p className="rounded-lg bg-stage-850/60 px-3 py-2 text-[11px] leading-relaxed text-ink-500 ring-1 ring-inset ring-stage-700/70">
          小說與短劇可以各走各的名字：小說頁與小說版本記錄用書名，製作與發行相關的頁面用劇名，
          兩者都找得到——三個名字都進搜尋索引。
        </p>

        <Field
          label="一句話簡介"
          description="作品工作區標頭會顯示這一行。"
          hint={<span className="text-[10px] text-ink-600">{logline.length} / 400</span>}
        >
          <Textarea
            value={logline}
            maxLength={400}
            rows={3}
            onChange={(event) => setLogline(event.target.value)}
            placeholder="一句話說清楚這部作品在講什麼。"
          />
        </Field>

        <Field
          label="小說封面"
          description="留空＝沿用作品封面。書架會用這張。"
        >
          {/*
            2:3, not 16:10. A book cover and a drama's key art are different
            pictures in different proportions, which is why they are separate
            columns rather than one shared image.
          */}
          <ImagePicker
            projectId={project.id}
            assetId={novelCoverAssetId}
            onChange={setNovelCoverAssetId}
            shape="portrait"
            label="書封"
            hint="直式書封，以書名為主。沒有的話書架會退回作品封面。"
          />
        </Field>

        <Field
          label="簡介"
          description="書架、片單與作品卡都會讀這段。"
          hint={<span className="text-[10px] text-ink-600">{synopsis.length} / 8000</span>}
        >
          <Textarea
            value={synopsis}
            maxLength={8000}
            rows={4}
            onChange={(event) => setSynopsis(event.target.value)}
            placeholder="故事的起承轉合、主角是誰、觀眾為什麼要看下去。"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="類型標籤" description="用逗號或空白分隔，最多 8 個。">
            <Input
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="古風 愛情 權謀"
            />
          </Field>

          <Field label="狀態">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ProjectStatusValue)}
              className="h-9 w-full rounded-lg bg-stage-900 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 outline-none focus:ring-2 focus:ring-accent-500"
            >
              {PROJECT_STATUSES.map((key) => (
                <option key={key} value={key} className="bg-stage-850">
                  {PROJECT_STATUS_LABEL[key]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="單集片長下限（秒）">
            <Input
              type="number"
              min={10}
              max={3600}
              value={targetMinSec}
              onChange={(event) => setTargetMinSec(event.target.value)}
            />
          </Field>
          <Field label="單集片長上限（秒）">
            <Input
              type="number"
              min={10}
              max={3600}
              value={targetMaxSec}
              onChange={(event) => setTargetMaxSec(event.target.value)}
            />
          </Field>
        </div>

        <Field label="單集目標字數">
          <Input
            type="number"
            min={100}
            max={100000}
            value={targetChars}
            onChange={(event) => setTargetChars(event.target.value)}
          />
        </Field>

        {error && (
          <p role="alert" className="text-[11px] text-rose-400">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* Cover                                                                       */
/* -------------------------------------------------------------------------- */

/** R2 accepts far larger files; this is a cover, and a 20 MB PNG is a mistake. */
const MAX_COVER_BYTES = 12 * 1024 * 1024

function CoverPicker({
  projectId,
  coverAssetId,
  savedCoverAssetId,
  onChange,
}: {
  projectId: string
  coverAssetId: string | null
  savedCoverAssetId: string | null
  onChange: (assetId: string | null) => void
}) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const uploader = useUploader({
    projectId,
    onComplete: (assetId) => onChange(assetId),
  })

  const active = uploader.items.find((item) =>
    ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
  )
  const failed = uploader.items.find((item) => item.status === 'failed')

  function accept(files: FileList | File[] | null) {
    setRejected(null)
    const file = Array.from(files ?? [])[0]
    if (!file) return

    // Checked here as well as on the server: telling the user immediately
    // beats uploading 12 MB and then being refused.
    // Same resolution the server uses; `file.type` alone rejects formats the
    // OS has no registry entry for.
    if (familyOf(resolveMimeType(file.name, file.type)) !== 'image') {
      setRejected(`「${file.name}」不是圖片檔`)
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      setRejected(`封面請小於 ${Math.round(MAX_COVER_BYTES / 1024 / 1024)} MB`)
      return
    }

    uploader.enqueue([file], 'IMAGE')
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-ink-200">作品封面</p>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col gap-3 rounded-xl p-3 ring-1 ring-inset transition-colors sm:flex-row sm:items-center',
          dragging ? 'bg-accent-600/10 ring-accent-500/60' : 'bg-stage-850/50 ring-stage-700/70'
        )}
      >
        <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-lg ring-1 ring-stage-700 sm:w-44">
          {coverAssetId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={assetPreviewUrl(coverAssetId)}
              alt="作品封面"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <div aria-hidden className="art-placeholder size-full" />
          )}

          {active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-stage-990/80 text-[11px] text-ink-200">
              <Loader2 aria-hidden className="size-4 animate-spin text-accent-400" />
              <span>{Math.round(active.progress * 100)}%</span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-ink-500">
            建議 16:10 的橫圖，JPG 或 PNG，小於{' '}
            {Math.round(MAX_COVER_BYTES / 1024 / 1024)} MB。
            可以直接把檔案拖進這個區塊。
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={
                coverAssetId ? (
                  <ImageUp aria-hidden className="size-3.5" />
                ) : (
                  <Upload aria-hidden className="size-3.5" />
                )
              }
              onClick={() => inputRef.current?.click()}
              disabled={Boolean(active)}
            >
              {coverAssetId ? '更換圖片' : '上傳圖片'}
            </Button>

            {coverAssetId && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Trash2 aria-hidden className="size-3.5" />}
                onClick={() => onChange(null)}
                disabled={Boolean(active)}
              >
                移除封面
              </Button>
            )}

            {coverAssetId !== savedCoverAssetId && !active && (
              <span className="inline-flex items-center rounded bg-amber-500/15 px-2 py-1 text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/40">
                按下「儲存」才會套用
              </span>
            )}
          </div>

          {rejected && (
            <p role="alert" className="text-[11px] text-rose-400">
              {rejected}
            </p>
          )}

          {failed && (
            <p role="alert" className="text-[11px] text-rose-400">
              上傳失敗：{failed.error}{' '}
              <button
                type="button"
                onClick={() => uploader.retry(failed.id)}
                className="underline underline-offset-2 hover:text-rose-300"
              >
                重試
              </button>
            </p>
          )}

          {active && (
            <button
              type="button"
              onClick={() => {
                void uploader.cancel(active.id).then(() => toast.info('已取消上傳'))
              }}
              className="self-start text-[11px] text-ink-500 underline underline-offset-2 hover:text-ink-200"
            >
              取消上傳
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={acceptFor('image')}
        className="hidden"
        onChange={(event) => {
          accept(event.target.files)
          // Reset, so picking the same file again still fires a change event.
          event.target.value = ''
        }}
      />
    </div>
  )
}
