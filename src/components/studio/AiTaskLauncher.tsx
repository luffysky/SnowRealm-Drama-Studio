'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { AiAssistant, type AiTask } from '@/components/studio/AiAssistant'
import { Dialog } from '@/components/ui/Dialog'
import type { AiJobKindValue } from '@/lib/constants'
import type { CurrencyValue, FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * 一顆按鈕，把 AI 任務面板開在任何一頁上 (Z153).
 *
 * `check:ai` 數出來六種任務「有 prompt、有定價、進得了佇列，介面上發動不
 * 了」。缺的不是六個功能，是**六個發動點**——面板本身早就做好了，只是只掛
 * 在小說與劇本編輯器上，而作品企劃、大綱審視、世界觀、素材都不在那兩頁。
 *
 * 所以這裡不再做一個面板，只做「把它開起來」這件事，而且做一次。六個各寫
 * 一份對話框，就是六份會各自分岔的估價流程。
 *
 * ## 沒有來源就說為什麼
 *
 * `disabledReason` 在按鈕被畫成不可按的時候一定要有值。spec v2 §4：
 * 「尚未串接的功能應禁用並顯示原因，不做空按鈕」——而這裡最常見的原因是
 * 「還沒有大綱可以審」，那是一句使用者看得懂、也知道怎麼解決的話。
 */
export function AiTaskLauncher({
  label,
  title,
  description,
  tasks,
  projectId,
  episodeId,
  sourceText = '',
  sourceTextByTask,
  novelSources,
  scopeLabel,
  currency,
  fx,
  providerReady,
  providerDetail,
  disabledReason,
  className,
  onAdopted,
}: {
  /** 按鈕上的字。 */
  label: string
  /** 對話框標題。 */
  title: string
  description?: string
  tasks: AiTask[]
  projectId: string
  episodeId?: string | null
  sourceText?: string
  sourceTextByTask?: Partial<Record<AiJobKindValue, string>>
  novelSources?: { id: string; number: number; title: string; charCount: number }[]
  scopeLabel?: string
  currency: CurrencyValue
  fx: FxRates
  providerReady: boolean
  providerDetail?: string
  /** 有值就把按鈕禁用，並把這句話顯示出來。 */
  disabledReason?: string
  className?: string
  onAdopted?: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        className={cn(
          'tap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] transition-colors',
          disabledReason
            ? 'cursor-not-allowed bg-stage-850 text-ink-600 ring-1 ring-inset ring-stage-700'
            : 'bg-accent-600 text-white hover:bg-accent-500',
          className
        )}
      >
        <Sparkles aria-hidden className="size-3.5" />
        {label}
      </button>

      {/*
        禁用的時候把原因寫在旁邊，不要只靠 title 屬性——觸控裝置上沒有滑鼠
        可以停留，那等於沒寫。
      */}
      {disabledReason && (
        <span className="text-[10px] leading-relaxed text-ink-600">{disabledReason}</span>
      )}

      {open && (
        <Dialog
          open
          onRequestClose={() => setOpen(false)}
          title={title}
          {...(description ? { description } : {})}
          size="lg"
        >
          <AiAssistant
            projectId={projectId}
            episodeId={episodeId ?? null}
            sourceText={sourceText}
            {...(sourceTextByTask ? { sourceTextByTask } : {})}
            {...(novelSources ? { novelSources } : {})}
            {...(scopeLabel ? { scopeLabel } : {})}
            tasks={tasks}
            currency={currency}
            fx={fx}
            providerReady={providerReady}
            {...(providerDetail ? { providerDetail } : {})}
            {...(onAdopted ? { onAdopted } : {})}
          />
        </Dialog>
      )}
    </>
  )
}
