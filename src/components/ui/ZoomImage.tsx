'use client'

import { Maximize2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * 一張可以放大看的圖：滑鼠移上去是放大鏡，手機長按是全螢幕 (Z181).
 *
 * ## 為什麼兩種互動不一樣
 *
 * 放大鏡在滑鼠上成立，是因為游標有一個「現在指著哪裡」的位置可以拿來當放大
 * 的中心。手指沒有這個——手指按下去的地方**正好被手指蓋住**，所以同一套做法
 * 在手機上是把你想看的那一塊藏起來。
 *
 * 所以手機走另一條：長按開全螢幕，整張圖 `object-contain` 攤開。那也是手機上
 * 真正要的東西——螢幕本來就小，使用者要的是「讓我看清楚整張」，不是「讓我看
 * 清楚這 60 像素」。
 *
 * ## 長按會跟瀏覽器打架
 *
 * iOS Safari 與 Android Chrome 都把圖片長按綁成「儲存圖片／分享」的系統選
 * 單，而那個選單一出來，後面的 `pointerup` 就不會來了。三件事一起做才擋得
 * 住：`touch-action: manipulation`（別等雙擊縮放）、`user-select: none` 加
 * `-webkit-touch-callout: none`（別選字、別跳系統選單）、以及按住期間把
 * `contextmenu` 擋掉。
 *
 * 四百毫秒是刻意偏短的：手機上捲動時手指碰到圖片會停留一下，太長會讓人以為
 * 沒反應，太短則捲動會誤觸。移動超過十像素就取消，那才是捲動與長按真正的分
 * 界。
 *
 * ## 放大鏡用 `background-position`，不是第二個 `<img>`
 *
 * 用一張 `background-size: 250%` 的底圖加上跟著游標跑的 `background-position`，
 * 瀏覽器只需要重算一個合成屬性。換成第二個 `<img>` 配 `transform` 也行，但那
 * 會讓同一張圖被解碼兩次——這裡一頁可能有十幾張參考圖。
 */

export type ZoomImageProps = {
  src: string
  alt: string
  /** 放大鏡裡的倍率。預設 2.5 倍。 */
  zoom?: number
  /** 放大鏡面板的邊長（px）。 */
  lensSize?: number
  /** 外框的 class。圖片本身一律 `object-contain`，不裁切。 */
  className?: string
  /** 圖片的 class，給呼叫端調整圓角等。 */
  imageClassName?: string
  /** 全螢幕時顯示在底部的說明。 */
  caption?: string
}

const LONG_PRESS_MS = 400
const MOVE_CANCEL_PX = 10

export function ZoomImage({
  src,
  alt,
  zoom = 2.5,
  lensSize = 260,
  className,
  imageClassName,
  caption,
}: ZoomImageProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  /*
   * 框的位置跟著游標位置一起存。
   *
   * 不在 render 的時候讀 `frameRef.current`：那是讀一個 render 階段不該碰的
   * 可變值（lint 的 `react-hooks/refs` 擋的就是這個），而且它會在 render 中
   * 強迫瀏覽器重算版面。`pointermove` 本來就拿得到元素，在那裡量一次就好。
   */
  const [lens, setLens] = useState<{
    x: number
    y: number
    box: { left: number; top: number; right: number; height: number }
  } | null>(null)
  const [full, setFull] = useState(false)

  /** 長按計時器與起點。手指移開十像素就不算長按了。 */
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  /*
   * 手指還按著沒放，所以系統選單要擋 (Z181，子代理審出來的).
   *
   * 本來只看 `pressRef`，而那個旗標在**計時器觸發的那一刻**就被清掉——也就是
   * 第 400 毫秒。而 Android Chrome 與 iOS 的長按選單門檻在 500 毫秒左右，正
   * 好在那之後。所以那個 `preventDefault` 剛好在它要發揮作用的前一刻關掉：它
   * 只擋得到「比 400ms 還早來的 contextmenu」，而那只有滑鼠右鍵——而滑鼠根本
   * 不會建 `pressRef`。
   *
   * iOS 另外有 `-webkit-touch-callout: none` 兜著，Android 沒有對應的屬性。
   * 所以改成一個獨立的旗標，按著就是真，放開才清。
   */
  const holdingRef = useRef(false)

  const cancelPress = useCallback(() => {
    holdingRef.current = false
    if (!pressRef.current) return
    window.clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }, [])

  useEffect(() => cancelPress, [cancelPress])

  /*
   * 捲動或改變視窗大小就把放大鏡收掉 (Z181，子代理審出來的).
   *
   * 面板的位置是 `pointermove` 當下量的視窗座標，而面板是 `fixed`。用滾輪捲
   * 動時瀏覽器**不保證**補一個 mousemove，所以面板會留在舊座標；圖被捲出畫面
   * 之後 `pointerleave` 同樣不會來，於是它就掛在那裡擋住後面的東西。
   *
   * 收掉而不是重算：滑鼠一動就會重新出現，而捲動到一半還黏著一塊放大鏡才是
   * 真的礙事。`capture` 是因為捲的可能是某個內層容器，不是視窗。
   */
  useEffect(() => {
    const clear = () => setLens(null)
    window.addEventListener('scroll', clear, { capture: true, passive: true })
    window.addEventListener('resize', clear, { passive: true })
    return () => {
      window.removeEventListener('scroll', clear, { capture: true })
      window.removeEventListener('resize', clear)
    }
  }, [])

  /*
   * 只有真的有「精確指標」的裝置才給放大鏡。
   *
   * 觸控螢幕上 `pointermove` 一樣會來（手指拖過去就是），而那會在手指底下開
   * 一塊看不見的放大鏡。用 `event.pointerType` 判斷而不是 media query：同一
   * 台機器可能兩種都有（觸控筆電），而要緊的是**這一次**是用什麼碰的。
   */
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') {
      if (pressRef.current) {
        const moved =
          Math.abs(event.clientX - pressRef.current.x) > MOVE_CANCEL_PX ||
          Math.abs(event.clientY - pressRef.current.y) > MOVE_CANCEL_PX
        if (moved) cancelPress()
      }
      return
    }

    const frame = frameRef.current
    if (!frame) return
    const box = frame.getBoundingClientRect()
    setLens({
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
      box: { left: box.left, top: box.top, right: box.right, height: box.height },
    })
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return
    cancelPress()
    holdingRef.current = true
    pressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        pressRef.current = null
        setFull(true)
      }, LONG_PRESS_MS),
    }
  }

  return (
    <>
      <div
        ref={frameRef}
        className={cn('relative overflow-hidden select-none', className)}
        style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          setLens(null)
          cancelPress()
        }}
        onPointerDown={onPointerDown}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        /* 按住期間不要跳出「儲存圖片」，那會把長按吃掉。 */
        onContextMenu={(event) => {
          if (holdingRef.current) event.preventDefault()
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cn('size-full object-contain', imageClassName)}
        />

        {/*
          開全螢幕的另一條路：鍵盤與讀螢幕的人沒有「長按」也沒有「hover」。
          放大鏡本身是純裝飾，所以它不需要自己的無障礙入口，這一顆需要。
        */}
        <button
          type="button"
          onClick={() => setFull(true)}
          aria-label={`放大看「${alt}」`}
          title="放大看"
          className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-md bg-stage-990/70 text-ink-300 opacity-0 transition-opacity hover:text-ink-50 focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-0"
        >
          <Maximize2 aria-hidden className="size-3" />
        </button>
      </div>

      {lens && !full && (
        <Lens src={src} at={lens} zoom={zoom} size={lensSize} />
      )}

      {full && <FullScreen src={src} alt={alt} caption={caption} onClose={() => setFull(false)} />}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * 伺服器端沒有 `document`，而 portal 需要它。
 *
 * 用 `useSyncExternalStore` 而不是「effect 裡 setState(true)」：後者是串連渲
 * 染，而 lint 擋的就是它（`react-hooks/set-state-in-effect`）。這正是那個
 * hook 存在的用途——讀一個只有用戶端才有的值。Dialog 裡也是同一個寫法。
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}

function subscribeNever() {
  return () => {}
}

/**
 * 跟著游標跑的那一塊。
 *
 * 用 portal 放到 `body`：這個面板一定會超出原本那個 `overflow-hidden` 的小方
 * 框，而留在裡面就會被裁掉——那正好是縮圖最需要放大鏡的情況。
 *
 * 位置貼著框的右邊，而靠近視窗右緣時翻到左邊。不跟著游標本身是刻意的：面板
 * 黏在游標旁邊會一直遮住它要放大的那張圖。
 */
function Lens({
  src,
  at,
  zoom,
  size,
}: {
  src: string
  at: {
    x: number
    y: number
    box: { left: number; top: number; right: number; height: number }
  }
  zoom: number
  size: number
}) {
  const mounted = useMounted()
  if (!mounted) return null

  const box = at.box
  const margin = 10
  const flip = box.right + margin + size > window.innerWidth
  const left = flip ? Math.max(margin, box.left - margin - size) : box.right + margin
  const top = Math.min(
    Math.max(margin, box.top + box.height / 2 - size / 2),
    Math.max(margin, window.innerHeight - size - margin)
  )

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 overflow-hidden rounded-lg bg-stage-950 shadow-2xl shadow-stage-990/80 ring-1 ring-stage-600"
      style={{
        left,
        top,
        width: size,
        height: size,
        backgroundImage: `url(${JSON.stringify(src)})`,
        backgroundRepeat: 'no-repeat',
        /*
         * `contain` 當基準再乘倍率：這樣放大鏡裡看到的構圖跟框裡那張一致
         * （兩邊都不裁切）。用 `cover` 的話，放大鏡會把框裡看得到的邊緣切掉，
         * 而那是最常需要看清楚的部分。
         */
        backgroundSize: `${zoom * 100}% ${zoom * 100}%`,
        backgroundPosition: `${at.x * 100}% ${at.y * 100}%`,
      }}
    />,
    document.body
  )
}

/** 長按（或按放大鈕）之後的全螢幕。整張攤開，不裁切。 */
function FullScreen({
  src,
  alt,
  caption,
  onClose,
}: {
  src: string
  alt: string
  caption?: string
  onClose: () => void
}) {
  const mounted = useMounted()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const { body } = document
    const overflow = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      body.style.overflow = overflow
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-stage-990/95 p-4 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        decoding="async"
        className="max-h-[85vh] max-w-full object-contain"
      />
      {caption && <p className="max-w-lg text-center text-[11px] text-ink-400">{caption}</p>}

      <button
        type="button"
        onClick={onClose}
        aria-label="關閉"
        className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-stage-900/80 text-ink-300 ring-1 ring-stage-700 transition-colors hover:text-ink-50"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>,
    document.body
  )
}
