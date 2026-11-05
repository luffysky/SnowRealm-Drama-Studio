'use client'

import { Loader2, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

/**
 * 上傳前先裁切 (Z65, design 31).
 *
 * 上傳與更換在 Z59 就做好了，**裁切沒做**——整張原圖存進去，構圖不能選。而
 * 封面在列表、卡片與工作區頂端都是固定比例的框，所以一張直式照片會被
 * `object-cover` 從中間切掉頭。
 *
 * ## 固定視窗、移動圖片
 *
 * 不是拖一個可變形的選取框，是把視窗鎖成目標比例，然後讓人拖曳與縮放底下
 * 的圖。這是頭像裁切器的做法，而它比可變形的選取框少掉一整類邊界情況：選
 * 取框不會跑出圖外、不會變成零寬、也不需要八個控制點。
 *
 * ## 不改原圖的格式
 *
 * 輸出沿用來源的 MIME（認不得就用 JPEG）。上傳管線會驗類型，而在這裡偷偷
 * 換成 WebP 會讓「我上傳的是 PNG」這句話變成不是真的。
 */

const ASPECT: Record<'wide' | 'portrait' | 'square', number> = {
  wide: 16 / 10,
  portrait: 2 / 3,
  square: 1,
}

/** 裁切視窗的像素寬。輸出解析度由它與比例決定。 */
const WINDOW_WIDTH = 480

export function CropDialog({
  file,
  shape,
  onCancel,
  onDone,
}: {
  file: File
  shape: 'wide' | 'portrait' | 'square'
  onCancel: () => void
  /** 裁好的檔案；按「用原圖」時回傳原本那一個。 */
  onDone: (file: File) => void
}) {
  const aspect = ASPECT[shape]
  const windowHeight = Math.round(WINDOW_WIDTH / aspect)

  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)

  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  /** 游標形狀要在 render 時知道，而 render 不可以讀 ref。 */
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  /*
   * `createObjectURL` 要收回。不收的話每開一次對話框就漏一張圖，而使用者會
   * 開很多次——裁切本來就是試幾次的事。
   */
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      /*
       * 置中在這裡算，不要用 effect 設 state。
       *
       * 「圖載好了就 setOffset」寫成 effect 的話，每次 render 都要再判斷一
       * 次要不要設——而 React 會把它當成串連渲染（lint 就是這樣擋的）。這裡
       * 本來就是事件處理函式，算好一次設完。
       */
      const fit = Math.max(WINDOW_WIDTH / img.naturalWidth, windowHeight / img.naturalHeight)
      setImage(img)
      setZoom(1)
      setOffset({
        x: (WINDOW_WIDTH - img.naturalWidth * fit) / 2,
        y: (windowHeight - img.naturalHeight * fit) / 2,
      })
    }
    img.onerror = () => setError('這張圖讀不進來，可能是檔案壞了。')
    img.src = url

    return () => URL.revokeObjectURL(url)
  }, [file, windowHeight])

  /** 讓圖至少蓋滿視窗的最小縮放。小於它就會露出空白。 */
  const minScale = image
    ? Math.max(WINDOW_WIDTH / image.naturalWidth, windowHeight / image.naturalHeight)
    : 1

  const scale = minScale * zoom

  /** 夾住位移，讓視窗永遠落在圖裡面。 */
  function clamp(next: { x: number; y: number }, atScale: number) {
    if (!image) return next
    const w = image.naturalWidth * atScale
    const h = image.naturalHeight * atScale
    return {
      x: Math.min(0, Math.max(WINDOW_WIDTH - w, next.x)),
      y: Math.min(0, Math.max(windowHeight - h, next.y)),
    }
  }

  function onPointerDown(event: React.PointerEvent) {
    if (!image) return
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    boxRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = dragRef.current
    if (!start) return
    setOffset(
      clamp(
        { x: start.ox + (event.clientX - start.x), y: start.oy + (event.clientY - start.y) },
        scale
      )
    )
  }

  function onPointerUp(event: React.PointerEvent) {
    dragRef.current = null
    setDragging(false)
    try {
      boxRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      /* 已經放開了 */
    }
  }

  function changeZoom(next: number) {
    if (!image) return
    /*
     * 以視窗中心為基準縮放，不是左上角。以左上角縮放的話，放大會把人正在看
     * 的部分推出畫面，要再拖回來。
     */
    const nextScale = minScale * next
    const cx = WINDOW_WIDTH / 2
    const cy = windowHeight / 2
    const ratio = nextScale / scale

    setZoom(next)
    setOffset(clamp({ x: cx - (cx - offset.x) * ratio, y: cy - (cy - offset.y) * ratio }, nextScale))
  }

  async function crop() {
    if (!image || busy) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = WINDOW_WIDTH
      canvas.height = windowHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('這個瀏覽器不支援 canvas')

      // 視窗左上角對應到原圖的哪一點。
      const sx = -offset.x / scale
      const sy = -offset.y / scale
      const sw = WINDOW_WIDTH / scale
      const sh = windowHeight / scale

      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, WINDOW_WIDTH, windowHeight)

      // 沿用來源格式：偷偷換格式會讓「我上傳的是 PNG」變成不是真的。
      const type = /^image\/(png|jpeg|webp)$/.test(file.type) ? file.type : 'image/jpeg'
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, 0.92)
      )
      if (!blob) throw new Error('裁切失敗')

      onDone(new File([blob], file.name, { type }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '裁切失敗')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onRequestClose={() => {
        if (!busy) onCancel()
      }}
      title="裁切封面"
      description="拖曳移動、拉桿縮放。視窗的比例就是這張圖實際顯示的比例。"
      busy={busy}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {/*
            「用原圖」要留著：有些圖本來就是對的比例，而強迫每一次都裁一刀
            只是多一道手續。
          */}
          <Button size="sm" variant="ghost" onClick={() => onDone(file)} disabled={busy}>
            用原圖，不裁切
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void crop()}
              loading={busy}
              loadingText="裁切中…"
              disabled={!image}
            >
              裁切並上傳
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-[11px] text-rose-400">
            {error}
          </p>
        )}

        <div
          ref={boxRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: WINDOW_WIDTH, height: windowHeight }}
          className="relative mx-auto max-w-full touch-none overflow-hidden rounded-lg bg-stage-950 ring-1 ring-stage-700"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.src}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: offset.x,
                top: offset.y,
                width: image.naturalWidth * scale,
                height: image.naturalHeight * scale,
                cursor: dragging ? 'grabbing' : 'grab',
              }}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[11px] text-ink-600">
              <Loader2 aria-hidden className="size-4 animate-spin" />
            </span>
          )}
        </div>

        <label className="flex items-center gap-2">
          <ZoomIn aria-hidden className="size-3.5 shrink-0 text-ink-500" />
          <span className="sr-only">縮放</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            disabled={!image}
            onChange={(event) => changeZoom(Number(event.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-stage-700 accent-accent-500 disabled:opacity-40"
          />
          <span className="w-10 shrink-0 text-right text-[10px] text-ink-600 tabular-nums">
            {zoom.toFixed(1)}×
          </span>
        </label>

        {image && (
          <p className="text-[10px] text-ink-600">
            原圖 {image.naturalWidth} × {image.naturalHeight}，
            裁切後 {WINDOW_WIDTH} × {windowHeight}
          </p>
        )}
      </div>
    </Dialog>
  )
}
