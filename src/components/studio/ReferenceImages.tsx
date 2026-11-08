'use client'

import { ImageUp, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type DragEvent } from 'react'
import { MAX_IMAGE_BYTES } from '@/components/studio/ImagePicker'
import { useUploader } from '@/components/studio/useUploader'
import { ZoomImage } from '@/components/ui/ZoomImage'
import { useToast } from '@/components/ui/Toast'
import { assetPreviewUrl } from '@/lib/asset-url'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { SHOT_REFERENCE_SLOT } from '@/lib/constants'
import { acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'
import type { ShotReference } from '@/lib/storyboard-view'
import { cn } from '@/lib/utils'

/**
 * 一個鏡頭的參考圖，可以傳很多張 (Z183).
 *
 * ## 跟首尾幀不是同一件事
 *
 * 這一區原本是一段說明：「首尾幀、候選圖與版本比較還沒有做：圖片生成供應商
 * 尚未接上」。那句話對**生成**成立，但參考圖不用生——它是人手上已經有的東
 * 西：這個場景的氛圍圖、這件道具的照片、要模仿的運鏡截圖。等圖片 adapter 接
 * 上之後，這些正是要餵給它的東西，所以先有它反而是下一步的前提。
 *
 * slot 分開（`ref` vs `first_frame`／`last_frame`）：一邊是人給模型看的，一
 * 邊是模型生出來的，混在同一個 slot 之後要分只能靠猜。
 *
 * ## 為什麼不用 `ImagePicker`
 *
 * 那一支是「一張圖，換掉就沒了」：它的 `onChange` 回一個 assetId、`移除` 的
 * 意思是「把這個欄位清空」。這裡是**清單**——傳第二張不該頂掉第一張，移除是
 * 解除一條連結。硬套的話會變成角色圖庫 Z168 修掉的那個誤解：按鈕寫「更換」而
 * 按下去是「新增」。
 *
 * ## 多選與拖放都收
 *
 * 參考圖通常是一次從資料夾裡挑五六張，所以 `multiple` 跟拖放都要有；一次一張
 * 的話，使用者要開五次檔案選擇器。上傳失敗的那幾張留在清單上可以重試，不會因
 * 為其中一張壞掉就整批不見。
 */
export function ReferenceImages({
  projectId,
  episodeId,
  shotId,
  items,
  canWrite,
}: {
  projectId: string
  /**
   * 這個鏡頭屬於哪一集 (Z183，子代理審出來的).
   *
   * 不帶的話素材的 `episode_id` 是 null，於是 `buildObjectKey` 把檔案丟進
   * `_project/` 而不是 `ep001/`，而它也不會出現在「本集素材」。R2 的路徑跟
   * 它實際的歸屬不符，是那種半年後才會有人發現的錯。
   */
  episodeId: string
  shotId: string
  items: ShotReference[]
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])
  const [removing, setRemoving] = useState<string | null>(null)

  const uploader = useUploader({
    projectId,
    episodeId,
    linkTo: { entityType: 'shot', entityId: shotId, slot: SHOT_REFERENCE_SLOT },
    /*
     * 每一張傳完都 refresh 一次。
     *
     * 看起來浪費，而替代方案更糟：等全部傳完再 refresh 的話，傳到一半離開這
     * 個鏡頭就什麼都沒有了——而上傳在背景繼續，連結也真的建了，於是畫面與資
     * 料庫不一致，重整才會出現。
     */
    onComplete: () => router.refresh(),
  })

  const busy = uploader.items.filter((item) =>
    ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
  )
  const failed = uploader.items.filter((item) => item.status === 'failed')

  function accept(files: FileList | File[] | null) {
    const chosen = Array.from(files ?? [])
    if (chosen.length === 0) return

    const ok: File[] = []
    const bad: string[] = []
    for (const file of chosen) {
      // `resolveMimeType` 而不是 `file.type`：Windows 對沒有登錄項的副檔名
      // 一律回 application/octet-stream。
      if (familyOf(resolveMimeType(file.name, file.type)) !== 'image') {
        bad.push(`「${file.name}」不是圖片檔`)
      } else if (file.size > MAX_IMAGE_BYTES) {
        bad.push(`「${file.name}」超過 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
      } else {
        ok.push(file)
      }
    }

    setRejected(bad)
    /*
     * 參考圖不走裁切對話框。
     *
     * 裁切存在的理由是「這張圖之後會被放進一個固定比例的框」，而參考圖沒有
     * 那個框——它是拿去給人跟模型看的。一次傳六張還要裁六次，那是把一個順手
     * 的動作變成一件差事。
     */
    if (ok.length > 0) uploader.enqueue(ok, 'IMAGE')
  }

  async function remove(assetId: string, label: string) {
    setRemoving(assetId)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/shots/${shotId}/references/${assetId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success('已移除', `「${label}」還在素材庫裡，只是不再掛在這個鏡頭上。`)
      router.refresh()
    } catch (cause) {
      toast.error('移除失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-[11px] font-medium text-ink-300">參考圖</h4>
        <p className="text-[10px] text-ink-600">
          氛圍、道具、想模仿的構圖。可以一次選多張，滑鼠移上去放大看，手機長按。
        </p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (canWrite) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault()
          setDragging(false)
          if (canWrite) accept(event.dataTransfer.files)
        }}
        className={cn(
          'flex flex-wrap gap-2 rounded-xl p-2.5 ring-1 transition-colors',
          dragging ? 'bg-accent-600/10 ring-accent-500' : 'bg-stage-900/60 ring-stage-700'
        )}
      >
        {items.map((item) => (
          <figure key={item.assetId} className="group relative">
            <ZoomImage
              src={assetPreviewUrl(item.assetId)}
              alt={item.label}
              caption={item.label}
              className="size-20 rounded-lg bg-stage-950 ring-1 ring-stage-700"
            />
            {canWrite && (
              <button
                type="button"
                disabled={removing === item.assetId}
                onClick={() => void remove(item.assetId, item.label)}
                aria-label={`把「${item.label}」從這個鏡頭移除`}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-stage-950 text-ink-400 ring-1 ring-stage-700 transition-colors hover:text-rose-300 disabled:opacity-50"
              >
                {removing === item.assetId ? (
                  <Loader2 aria-hidden className="size-2.5 animate-spin" />
                ) : (
                  <X aria-hidden className="size-3" />
                )}
              </button>
            )}
          </figure>
        ))}

        {busy.map((item) => (
          <span
            key={item.id}
            className="grid size-20 shrink-0 place-items-center rounded-lg bg-stage-950 text-[10px] text-ink-400 ring-1 ring-stage-700"
          >
            <Loader2 aria-hidden className="size-4 animate-spin" />
            {Math.round(item.progress * 100)}%
          </span>
        ))}

        {canWrite && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={acceptFor('image')}
              onChange={(event) => {
                accept(event.target.files)
                // 同一批檔案連選兩次也要有反應，所以清掉 value。
                event.target.value = ''
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="grid size-20 shrink-0 place-items-center gap-1 rounded-lg border border-dashed border-stage-700 text-[10px] text-ink-500 transition-colors hover:border-stage-500 hover:text-ink-300"
            >
              <ImageUp aria-hidden className="size-4" />
              加參考圖
            </button>
          </>
        )}

        {items.length === 0 && busy.length === 0 && !canWrite && (
          <p className="px-1 py-6 text-[10px] text-ink-600">這個鏡頭還沒有參考圖。</p>
        )}
      </div>

      {rejected.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[10px] text-amber-300">
          {rejected.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {failed.map((item) => (
        <p key={item.id} className="text-[10px] text-rose-300">
          「{item.file.name}」上傳失敗：{item.error ?? '請再試一次'}
          <button
            type="button"
            onClick={() => uploader.retry(item.id)}
            className="ml-1.5 underline underline-offset-2"
          >
            重試
          </button>
        </p>
      ))}
    </section>
  )
}
