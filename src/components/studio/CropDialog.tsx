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

/**
 * 比例要跟**實際顯示的框**一致 (Z165).
 *
 * `wide` 本來寫 16/10，而全專案每一個真的顯示封面的地方都是 `aspect-video`
 * ——作品卡、集數詳情、影片播放、作品總覽、集數卡片。實測作品卡封面是
 * 373×210 ≈ 16:9。
 *
 * 差這一點的後果不是醜，是**對話框那句「視窗的比例就是這張圖實際顯示的比
 * 例」不成立**：裁成 16:10 之後 `object-cover` 會再切掉上下約 5%，於是人
 * 對好的構圖還是會被切。一個說謊的預覽比沒有預覽糟。
 */
const ASPECT: Record<'wide' | 'portrait' | 'square', number> = {
  wide: 16 / 9,
  portrait: 2 / 3,
  square: 1,
}

/**
 * 裁切視窗的顯示上限。**只是 UI**，跟輸出解析度無關。
 *
 * `free` 之前只有寬度是固定的，因為其他三種形狀的高度由比例決定、而那三個比
 * 例都不會太高。原圖比例可以是任何東西（一張 1:4 的直幅），所以高度也要有上
 * 限，不然對話框會長到按鈕被擠出螢幕。
 */
const WINDOW_MAX_WIDTH = 480
const WINDOW_MAX_HEIGHT = 420

/**
 * 輸出解析度上限，依形狀分開 (Z165).
 *
 * 輸出本來直接用視窗的 480 寬，而那是**做了比不做糟**的那種：
 *
 *  - 作品卡封面實測最寬 387 CSS px，DPR 2 的螢幕要 774 裝置像素——480 等於
 *    1.6 倍上採樣，看得出來的糊。而上傳原圖本來是清楚的。
 *  - 更糟的是角色定妝照：它走同一支（`shape="portrait"`），而那張圖的用途
 *    寫在它自己的提示裡——「分鏡與 AI 生圖會拿這張當角色的樣貌參考」。把
 *    AI 的參考圖壓到 480 寬，之後每一張生出來的圖都從那裡開始。
 *
 * 絕不**上**採樣：輸出取「裁切區域的原始像素」與這個上限的較小者，所以小
 * 圖不會被放大成一張更大的糊圖。
 */
const OUTPUT_MAX: Record<CropShape, number> = {
  wide: 1920,
  portrait: 1440,
  square: 1024,
  /*
   * `free` 給得比其他都高，因為它現在是角色圖走的那一條 (Z180)，而角色圖的
   * 用途寫在它自己的提示裡：分鏡與 AI 生圖會拿它當樣貌參考。
   */
  free: 2048,
}

/**
 * `free` ＝ 不限長寬 (Z180).
 *
 * 其他三種是「這張圖之後會被放進一個固定比例的框」，所以裁切視窗長什麼樣，
 * 顯示的時候就長什麼樣。角色圖不是那樣——它會被放進分鏡與 AI 的參考，而那些
 * 地方要的是**完整的人**，不是一個 2:3 的切片。
 *
 * 所以 `free` 的裁切視窗用**原圖自己的比例**：打開來就是整張圖，按「裁切並上
 * 傳」只是讓人把邊緣修掉，而不是逼人選一塊。「用原圖，不裁切」在這個形狀下跟
 * 預設畫面一模一樣，這是刻意的。
 */
export type CropShape = 'wide' | 'portrait' | 'square' | 'free'

/**
 * 來源像素上限。
 *
 * iOS Safari 單張圖解碼約 16.7 MP 就會自行降採樣或讓 `drawImage` 畫出空
 * 白——而 `toBlob` 仍然會回一個合法的 blob，於是**一張全黑的封面會安靜地被
 * 上傳**。`MAX_IMAGE_BYTES` 擋不住：8000×6000 的 JPEG 很容易低於 12 MB。
 *
 * 兩個用途：顯示一句警語，以及決定要不要跑 `canvasHasPixels()`。後者本來是
 * **每一張圖都跑**，所以這個常數只是個註解；現在它真的在擋東西 (Z166)。
 */
const MAX_SOURCE_PIXELS = 16_000_000

/**
 * 裁切視窗在畫面上的大小。
 *
 * 寬高各有上限，所以極端比例（很高的直幅、很長的橫幅）不會把對話框撐爆。取
 * 兩個上限裡**先碰到**的那一個當基準。
 */
function windowBox(aspect: number): { width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  if (safe >= WINDOW_MAX_WIDTH / WINDOW_MAX_HEIGHT) {
    return { width: WINDOW_MAX_WIDTH, height: Math.round(WINDOW_MAX_WIDTH / safe) }
  }
  return { width: Math.round(WINDOW_MAX_HEIGHT * safe), height: WINDOW_MAX_HEIGHT }
}

/**
 * 畫布上有沒有任何東西被畫上去 (Z166).
 *
 * 跨整張均勻抽樣（約 4096 個點），只要有一個點不是完全透明就算有畫到。
 *
 * 上一版只抽**左上角 64×64**，於是一張去背的 PNG（人物居中、四角透明）會被
 * 判成「畫不出來」——而角色定妝照正是這一支最主要的用途，去背人像的左上角本
 * 來就是透明的。
 *
 * 只看 alpha 是對的：Safari 畫不出來的時候整張都是 alpha 0，而任何真的畫上
 * 去的像素 alpha 都大於 0。
 *
 * 要說清楚它蓋不到什麼：Safari 的另一種行為是**自行降採樣**——那會畫出看得
 * 見但座標錯位的內容，alpha 檢查照樣通過，裁出來的構圖是錯的。這裡沒有辦法
 * 偵測那個，所以超過上限時另外顯示警語請人先縮小再上傳。
 */
function canvasHasPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  const { data } = ctx.getImageData(0, 0, width, height)
  // 乘 4 讓步進永遠落在 alpha 通道上。
  const stride = Math.max(1, Math.floor((width * height) / 4096)) * 4
  for (let i = 3; i < data.length; i += stride) {
    if (data[i] !== 0) return true
  }
  return false
}

export function CropDialog({
  file,
  shape,
  onCancel,
  onDone,
}: {
  file: File
  shape: CropShape
  onCancel: () => void
  /** 裁好的檔案；按「用原圖」時回傳原本那一個。 */
  onDone: (file: File) => void
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  /*
   * `free` 的比例要等圖載進來才知道，所以先用 1 擋著。
   *
   * 讀 `image` 就好、不另外存一份比例：多一份會有「圖換了、比例還是舊的」那
   * 一格的不一致，而那一格正好是視窗尺寸在變的時候。
   */
  const aspect =
    shape === 'free' ? (image ? image.naturalWidth / image.naturalHeight : 1) : ASPECT[shape]
  const { width: windowWidth, height: windowHeight } = windowBox(aspect)
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
       * 視窗尺寸在這裡**重算一次**，不能用外面那個。
       *
       * 外面那個是用 `image` 算的，而這一刻 `image` 還是上一張（或 null）。
       * 把它放進 effect 的依賴裡則會打轉：設了圖 → 比例變 → 視窗變 →
       * effect 重跑 → 再載一次圖。
       */
      const loadedAspect =
        shape === 'free' ? img.naturalWidth / img.naturalHeight : ASPECT[shape]
      const box = windowBox(loadedAspect)
      /*
       * 置中在這裡算，不要用 effect 設 state。
       *
       * 「圖載好了就 setOffset」寫成 effect 的話，每次 render 都要再判斷一
       * 次要不要設——而 React 會把它當成串連渲染（lint 就是這樣擋的）。這裡
       * 本來就是事件處理函式，算好一次設完。
       */
      const fit = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight)
      setImage(img)
      setZoom(1)
      setOffset({
        x: (box.width - img.naturalWidth * fit) / 2,
        y: (box.height - img.naturalHeight * fit) / 2,
      })
    }
    img.onerror = () => setError('這張圖讀不進來，可能是檔案壞了。')
    img.src = url

    return () => URL.revokeObjectURL(url)
  }, [file, shape])

  /** 讓圖至少蓋滿視窗的最小縮放。小於它就會露出空白。 */
  const minScale = image
    ? Math.max(windowWidth / image.naturalWidth, windowHeight / image.naturalHeight)
    : 1

  const scale = minScale * zoom

  /** 告訴人實際會存成多大，不是視窗多大。 */
  const outputSize = (() => {
    const sw = windowWidth / scale
    const width = Math.max(1, Math.round(Math.min(sw, OUTPUT_MAX[shape])))
    /*
     * 用**視窗的實際比例**，不是原圖的 `aspect`。
     *
     * `windowBox()` 會把寬高 round 成整數像素，所以真正裁下來的那一塊的比例
     * 是 `windowWidth / windowHeight`，跟 `aspect` 差一點點。一般比例差
     * 0.2% 看不出來，而極端比例（很長的橫幅）會變成看得見的垂直拉伸。
     */
    return {
      width,
      height: Math.max(1, Math.round((width * windowHeight) / windowWidth)),
    }
  })()

  /** 夾住位移，讓視窗永遠落在圖裡面。 */
  function clamp(next: { x: number; y: number }, atScale: number) {
    if (!image) return next
    const w = image.naturalWidth * atScale
    const h = image.naturalHeight * atScale
    return {
      x: Math.min(0, Math.max(windowWidth - w, next.x)),
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
    const cx = windowWidth / 2
    const cy = windowHeight / 2
    const ratio = nextScale / scale

    setZoom(next)
    setOffset(clamp({ x: cx - (cx - offset.x) * ratio, y: cy - (cy - offset.y) * ratio }, nextScale))
  }

  async function crop() {
    if (!image || busy) return
    setBusy(true)
    try {
      // 視窗左上角對應到原圖的哪一點。
      const sx = -offset.x / scale
      const sy = -offset.y / scale
      const sw = windowWidth / scale
      const sh = windowHeight / scale

      /*
       * 輸出取「裁切區域的原始像素」與上限的較小者——不上採樣。
       *
       * 視窗是 480 寬只是為了畫面好看；把它直接當輸出解析度，等於每一張封面
       * 都被壓成 480，而顯示的地方要 774。
       */
      const outWidth = Math.max(1, Math.round(Math.min(sw, OUTPUT_MAX[shape])))
      // 跟 `outputSize` 同一條算式——畫面上寫幾乘幾，存出來就要是幾乘幾。
      const outHeight = Math.max(1, Math.round((outWidth * windowHeight) / windowWidth))

      const canvas = document.createElement('canvas')
      canvas.width = outWidth
      canvas.height = outHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('這個瀏覽器不支援 canvas')

      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outWidth, outHeight)

      /*
       * 只有**超大圖**才檢查畫出來是不是全空 (Z166).
       *
       * 這個檢查存在的唯一理由是 iOS Safari 在 `MAX_SOURCE_PIXELS` 以上會讓
       * `drawImage` 什麼都不畫而 `toBlob` 照樣回一個合法的 blob。對每一張圖
       * 都跑它，換來的是把去背 PNG 誤殺成「這張圖太大」——一張 800KB 的小圖
       * 完全無法裁切，而錯誤訊息還在說它太大。
       */
      if (
        image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS &&
        !canvasHasPixels(ctx, outWidth, outHeight)
      ) {
        throw new Error('這張圖太大，瀏覽器畫不出來。請用「用原圖，不裁切」或先縮小再上傳。')
      }

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
      title={shape === 'free' ? '確認這張圖' : '裁切封面'}
      description={
        shape === 'free'
          ? '這張圖不限長寬，打開就是整張。想修掉邊緣再拖曳縮放，否則直接「用原圖」。'
          : '拖曳移動、拉桿縮放。視窗的比例就是這張圖實際顯示的比例。'
      }
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
          style={{ width: windowWidth, height: windowHeight }}
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
            裁切後 {outputSize.width} × {outputSize.height}
            {image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS && (
              <span className="ml-1 text-amber-400">
                這張圖很大，部分瀏覽器可能畫不出來——裁完如果是黑的，改用「用原圖」。
              </span>
            )}
          </p>
        )}
      </div>
    </Dialog>
  )
}
