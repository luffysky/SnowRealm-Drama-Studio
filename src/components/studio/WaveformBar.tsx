'use client'

import { useEffect, useRef, useState } from 'react'
import type { WaveformData } from '@/lib/audio-waveform'
import { apiFetch } from '@/lib/client-fetch'

/**
 * 浮動播放器的波形 (Z140).
 *
 * 「音樂播放器在播音樂的時候沒有波形，這樣沒感覺」。確實沒有——浮動播放器
 * 從頭到尾只有一條 6px 的進度條，整個元件裡沒有 canvas。波形本來只畫在素材
 * 頁，而那是另一個頁面。
 *
 * ## 峰值是現成的，不是現算的
 *
 * `asset_variants` 裡本來就有 `WAVEFORM` 這種衍生檔案——上傳的時候瀏覽器
 * 就算好存上去了（`useUploader.ts`）。所以這裡只要去拿，不必下載整首歌再
 * 解碼一次。一首三分鐘的 MP3 是好幾 MB，它的峰值是幾 KB。
 *
 * ## 沒有峰值就退回那條進度條
 *
 * 不畫一個看起來合理的假波形。素材頁那邊的規格講得很清楚，這裡沿用同一條
 * 規則：**假波形比沒有波形更糟**，因為它會請人去捲到一個根本不存在的高峰，
 * 而畫面上沒有任何東西說這張圖是編出來的。
 *
 * TTS 產出的有聲書現在就是沒有峰值的那一類：它由伺服器端的 worker 直接寫
 * 進 R2，沒走過瀏覽器上傳那條路，所以沒有人幫它算過。
 */

/** 播放器裡的高度。比素材頁矮，但夠看出起伏。 */
const BAR_HEIGHT = 30

export function WaveformBar({
  assetId,
  current,
  duration,
  onSeek,
}: {
  assetId: string
  current: number
  duration: number
  onSeek: (seconds: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  /**
   * 峰值，**連它屬於哪一軌一起存**。
   *
   * 不存這個 assetId 的話，換歌時就得在 effect 裡先 `setWaveform(null)` 清掉
   * ——而那是同步在 effect 裡設狀態，會引起連鎖重繪（lint 擋的就是這個）。
   * 存著比對反而更對：下一首的峰值還沒拿到的那幾百毫秒，畫面不會先閃一下
   * **上一首的波形**。
   */
  const [loaded, setLoaded] = useState<{ assetId: string; data: WaveformData } | null>(null)

  /* ------------------------------------------------------------- 拿峰值 */

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await apiFetch(`/api/files/${assetId}/waveform`)
        // 404 是正常狀態，不是故障：這個素材就是沒有波形資料。
        if (!response.ok) return
        const body = (await response.json()) as WaveformData
        if (!cancelled && Array.isArray(body.peaks) && body.peaks.length > 0) {
          setLoaded({ assetId, data: body })
        }
      } catch {
        // 退回進度條。播放不該因為畫不出圖而中斷。
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assetId])

  const waveform = loaded?.assetId === assetId ? loaded.data : null

  /* --------------------------------------------------------------- 畫圖 */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return

    const draw = () => {
      const context = canvas.getContext('2d')
      if (!context) return

      /*
       * 每次畫都重新照 devicePixelRatio 設一次後備緩衝區的大小，而不是只在
       * 掛載時設一次——浮動播放器會展開收合，視窗會縮放，手機會轉向，這幾
       * 件事都會改變寬度而不會重新掛載。
       */
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return

      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const barWidth = 2
      const gap = 1
      const columns = Math.max(1, Math.floor(width / (barWidth + gap)))
      const middle = height / 2
      const played = duration > 0 ? current / duration : 0

      /** 幾個峰值併成一根柱子。畫面的柱子永遠比峰值少。 */
      const perColumn = waveform.peaks.length / columns

      for (let column = 0; column < columns; column += 1) {
        const from = Math.floor(column * perColumn)
        const to = Math.max(from + 1, Math.floor((column + 1) * perColumn))

        let peak = 0
        for (let i = from; i < to && i < waveform.peaks.length; i += 1) {
          const value = waveform.peaks[i] ?? 0
          if (value > peak) peak = value
        }

        // 至少一個畫素高：完全靜音的一段還是該看得出那裡有東西。
        const barHeight = Math.max(1, peak * (height - 2))
        const x = column * (barWidth + gap)

        // 跟素材頁那支用同一組顏色，不然同一個檔案在兩個地方長得不一樣。
        context.fillStyle =
          column / columns <= played ? 'rgb(167 139 250)' : 'rgb(76 54 128)'
        context.fillRect(x, middle - barHeight / 2, barWidth, barHeight)
      }
    }

    draw()

    /*
     * 寬度變了要重畫。`ResizeObserver` 而不是 window 的 resize 事件：播放器
     * 自己展開收合時視窗沒有變，但這個 canvas 變了。
     */
    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [waveform, current, duration])

  const progress = duration > 0 ? current / duration : 0

  /*
   * 高度由這個元件自己決定，因為只有它知道有沒有峰值。
   *
   * 本來想讓外面那個容器決定，但外面是 `h-1.5`（6px）——而外面無從知道這
   * 一軌有沒有波形可畫。結果就是 canvas 被壓成一條線，或者沒有波形的歌也
   * 空出 30px。所以整個控制項（底圖、波形、拖曳用的 range）都搬進來。
   */
  return (
    <div className="relative" style={{ height: waveform ? BAR_HEIGHT : 6 }}>
      {waveform ? (
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      ) : (
        /*
         * 原來那條進度條，一模一樣。沒有峰值的素材看起來跟以前完全相同——
         * 這個功能不該讓任何東西變差。
         */
        <>
          <div className="absolute inset-0 rounded-full bg-stage-800" />
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-accent-500"
            style={{ width: `${progress * 100}%` }}
          />
        </>
      )}

      <label className="sr-only" htmlFor="music-seek">
        播放位置
      </label>
      <input
        id="music-seek"
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={current}
        onChange={(event) => onSeek(Number(event.target.value))}
        /* `-inset-y-3` so the thumb is draggable on a phone; the bar itself
           is a few pixels tall and a finger is not. */
        className="absolute inset-x-0 -inset-y-3 w-full cursor-pointer opacity-0"
      />
    </div>
  )
}
