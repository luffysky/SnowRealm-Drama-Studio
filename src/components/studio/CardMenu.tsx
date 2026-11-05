'use client'

import { Check, Link2, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
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
  const boxRef = useRef<HTMLDivElement>(null)

  /*
   * 點外面與 Escape 都要關。
   *
   * 只做其中一個的話，在手機上就關不掉——那裡沒有 Escape，而點外面是唯一的
   * 直覺。
   */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
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

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          // 卡片整張是連結，選單不該順便把人帶走。
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className="tap rounded p-0.5 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="panel absolute right-0 bottom-full z-30 mb-1 flex w-40 flex-col overflow-hidden rounded-lg bg-stage-850 py-1 ring-1 shadow-xl ring-stage-700"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              role="menuitem"
              href={item.href}
              onClick={(event) => event.stopPropagation()}
              className="px-3 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-800 hover:text-ink-50"
            >
              {item.label}
            </Link>
          ))}

          <span aria-hidden className="my-1 h-px bg-stage-700" />

          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void copy()
            }}
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
        </div>
      )}
    </div>
  )
}
