'use client'

import { Check, Link2, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

/**
 * 作品卡的「更多操作」(Z38, design 03).
 *
 * 那顆 `…` 本來是個禁用的 `<span>`，標題寫著「更多操作尚未實作，預計於 M1
 * 階段交付」。
 *
 * ## 裡面只放真的存在的東西
 *
 * 沒有「刪除作品」：全專案**沒有任何刪除作品的路由**（`project.delete` 這個
 * 權限存在，但沒有端點實作它）。放一個會噴 404 的選項，比沒有這個選單更糟。
 *
 * 沒有「作品設定」：那個對話框在作品工作區的右上角，而從這裡連過去只會到總
 * 覽頁——一個叫「作品設定」卻把你帶到別的地方的選項是在說謊。
 *
 * 剩下的就是導覽捷徑：從作品列表直接跳進某一個分頁，省掉先進總覽再點的那一
 * 下。加上複製連結，因為兩個人要互相丟連結。
 *
 * ## 為什麼要 portal 出去 (Z166)
 *
 * 整張作品卡的根**就是** `<Link>`，而且帶 `overflow-hidden`。選單畫在卡片裡
 * 面的話只有兩種結果，兩種都壞：
 *
 *  - 往上開：被封面那一段裁掉，看不到最前面幾項。
 *  - 往下開：更糟。按鈕在卡片 body 中段，它**下方**到卡片底只剩進度條加
 *    footer，大約 70px；上方至少還有 170px。Z165 把它從往上改成往下，是把被
 *    切掉的部分從一兩項變成五項。
 *
 * `max-h-48` + `overflow-y-auto` 救不了：裁切的是**祖先**的 `overflow-
 * hidden`，而選單的自然高度（約 188px）本來就小於 `max-h-48`，所以那個內部
 * 滾動條永遠不會出現。
 *
 * portal 到 `document.body` 之後：不再有祖先裁它、空間不夠會自己換邊、而且
 * 項目在 DOM 上不再是那個 `<a>` 的後代——所以它們可以是真正的 `<Link>`，中
 * 鍵開新分頁、Ctrl/⌘ 點擊、右鍵複製連結、prefetch 全都回來了。Z165 把它們換
 * 成 `<button>` + `router.push` 並沒有解決任何事：`<button>` 同樣是
 * interactive content，`<a>` 的內容模型一樣禁止，可及名稱一樣會被吃進去，只
 * 是順便把中鍵和 Ctrl 點擊弄壞了。
 *
 * 那顆 `…` 本身還留在 `<a>` 裡面，所以它用 `<span role="button">`——跟同一張
 * 卡上的收藏鍵一樣的理由、一樣的做法。
 */

export type CardMenuItem = { href: string; label: string }

export function CardMenu({
  label,
  items,
  shareUrl,
}: {
  /** 給螢幕閱讀器：「《一灶見山河》的更多操作」。 */
  label: string
  items: CardMenuItem[]
  /** 複製到剪貼簿的連結；相對路徑，開啟時才補上網域。 */
  shareUrl: string
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  /**
   * 面板的位置與最大高度，從同一次量測算出來。
   *
   * 邊（上緣或下緣）跟 `maxHeight` 一定要同時決定：分開寫就會出現「貼著下緣
   * 展開、但高度是用上方空間算的」這種對不上的組合。`FloatingChat` 的
   * `panelBox` 是同一個理由。
   */
  const [box, setBox] = useState<React.CSSProperties | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const gap = 6
    const edge = 8
    const below = window.innerHeight - rect.bottom - gap - edge
    const above = rect.top - gap - edge

    setBox({
      position: 'fixed',
      right: Math.max(edge, window.innerWidth - rect.right),
      // 空間多的那一邊。兩邊都不夠時至少留 120px 並讓它自己滾。
      ...(below >= above
        ? { top: rect.bottom + gap, maxHeight: Math.max(120, below) }
        : { bottom: window.innerHeight - rect.top + gap, maxHeight: Math.max(120, above) }),
    })
  }

  /*
   * 點外面與 Escape 都要關。
   *
   * 只做其中一個的話，在手機上就關不掉——那裡沒有 Escape，而點外面是唯一的
   * 直覺。
   *
   * 捲動與改變視窗大小也關：面板是 `position: fixed`，不關的話它會留在原地而
   * 卡片已經捲走了。跟著捲需要每一帧重算，而這是個點一下就走的選單，不值得。
   */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const close = () => setOpen(false)

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${shareUrl}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 權限被擋或不是安全來源。說出來，不要靜悄悄什麼都沒發生。
      toast.error('複製不了', '瀏覽器擋下了剪貼簿存取。')
    }
  }

  function toggle(event: React.SyntheticEvent) {
    // 卡片整張是連結，選單不該順便把人帶走。
    event.preventDefault()
    event.stopPropagation()
    if (!open) place()
    setOpen((value) => !value)
  }

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') toggle(event)
        }}
        className="tap shrink-0 cursor-pointer rounded p-0.5 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
      >
        <MoreHorizontal className="size-4" />
      </span>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            /*
             * React 的事件還是沿著元件樹走，portal 不改這件事——所以點擊照樣會
             * 冒泡到外層那個 `<Link>` 的 onClick，然後把人帶到作品總覽。
             *
             * 只 `stopPropagation`，**不要** `preventDefault`：項目自己的
             * `<Link>` 要能正常導覽。它在冒泡途中先跑完，才輪到這裡擋下來。
             */
            onClick={(event) => event.stopPropagation()}
            style={box}
            className="panel z-50 flex w-40 flex-col overflow-y-auto rounded-lg bg-stage-850 py-1 ring-1 shadow-xl ring-stage-700"
          >
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-left text-[11px] text-ink-300 transition-colors hover:bg-stage-800 hover:text-ink-50"
              >
                {item.label}
              </Link>
            ))}

            <span aria-hidden className="my-1 h-px bg-stage-700" />

            <button
              type="button"
              role="menuitem"
              onClick={() => void copy()}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-stage-800',
                copied ? 'text-emerald-300' : 'text-ink-300 hover:text-ink-50'
              )}
            >
              {copied ? (
                <Check aria-hidden className="size-3" />
              ) : (
                <Link2 aria-hidden className="size-3" />
              )}
              {copied ? '已複製' : '複製作品連結'}
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
