'use client'

import { Check, Loader2, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  suggestVocabularyValue,
  vocabularyLabel,
  vocabularyOptions,
  type VocabularyKind,
  type VocabularyTerm,
} from '@/lib/vocabulary-view'
import { cn } from '@/lib/utils'

/**
 * 一個可以自己加選項的下拉 (Z184).
 *
 * ## 「新增…」為什麼是下拉裡的一個選項
 *
 * 旁邊放一顆「＋」按鈕是另一種做法，而它在一列已經很擠的表單裡會再吃掉寬度，
 * 手機上尤其。放進下拉裡的代價是：選到它會觸發一個不是「選值」的動作，所以
 * `onChange` 要分兩條路——而那一條路寫錯的話，使用者會選到一個叫
 * `__add__` 的景別。所以哨兵值走一個不可能是合法代碼的字串（合法代碼是
 * `^[A-Z][A-Z0-9_]*$`），而且選完立刻把下拉彈回原值。
 *
 * ## 代碼是使用者看得到的
 *
 * 新增時要填兩格：**顯示名稱**與**代碼**。代碼會從名稱猜一個（純中文猜不
 * 出，就留白讓人自己填），而且它看得見——因為它會出現在 AI 提示詞、匯出的
 * CSV，以及之後任何一個讀資料庫的人眼前。藏起來的話，那些地方會冒出
 * `CUSTOM_3` 而沒有人知道它是什麼。
 *
 * ## 刪掉之後，用過它的資料會怎樣
 *
 * 照樣留著那個值。這張表是「下拉裡有哪些選項」，不是「資料裡有哪些值」——擋
 * 著不給刪的話，一個打錯字的選項只要被存過一次就永遠刪不掉。而
 * `vocabularyTermLabel` 查不到會回值本身，所以畫面上看得到 `HANDHELD_LOW`，
 * 不是一個空格。
 */

/** 不可能是合法代碼，所以不會跟真的值撞。 */
const ADD_SENTINEL = '+add'

export function VocabularySelect({
  kind,
  terms,
  value,
  onChange,
  disabled,
  canManage = true,
  className,
}: {
  kind: VocabularyKind
  terms: readonly VocabularyTerm[]
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** 唯讀的人只看得到清單，看不到「新增…」。 */
  canManage?: boolean
  className?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const formId = useId()

  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const options = vocabularyOptions(kind, terms)
  const name = vocabularyLabel(kind)

  /*
   * 目前這個值如果不在清單裡（自訂的被刪掉了），還是要顯示它。
   * 不補的話 `<select>` 會自己跳到第一個選項，而那等於**沒有人按就改了資料**。
   */
  const orphan = value && !options.some((option) => option.value === value)

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch('/api/vocabulary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, label: label.trim(), value: code.trim().toUpperCase() }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { term: VocabularyTerm }
      toast.success(`已新增${name}`, `「${body.term.label}」現在在清單裡了。`)
      setAdding(false)
      setLabel('')
      setCode('')
      // 選中剛加的那一個——加完還要自己再選一次，是多一道沒有道理的手續。
      onChange(body.term.value)
      router.refresh()
    } catch (cause) {
      toast.error('新增失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function remove(termId: string, termLabel: string) {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/vocabulary/${termId}?kind=${kind}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success('已刪除', `已經用過「${termLabel}」的鏡頭不受影響，仍然顯示它。`)
      router.refresh()
    } catch (cause) {
      toast.error('刪除失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-stage-850/60 p-2 ring-1 ring-stage-700">
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={label}
            maxLength={20}
            placeholder={`新的${name}`}
            aria-label={`新的${name}名稱`}
            onChange={(event) => {
              setLabel(event.target.value)
              // 只在使用者還沒自己改過代碼的時候跟著猜。
              setCode((current) =>
                current === suggestVocabularyValue(label) ? suggestVocabularyValue(event.target.value) : current
              )
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(false)
            }}
            className="h-8 min-w-0 flex-1 rounded-md bg-stage-900 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
          <input
            value={code}
            maxLength={32}
            placeholder="代碼 A-Z"
            aria-label={`新的${name}代碼`}
            aria-describedby={formId}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
              if (event.key === 'Escape') setAdding(false)
            }}
            className="h-8 w-28 shrink-0 rounded-md bg-stage-900 px-2 font-mono text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </div>

        <p id={formId} className="text-[10px] leading-relaxed text-ink-600">
          代碼會出現在 AI 提示詞與匯出的檔案裡，所以讓它看得懂。只能用大寫英文、數字與底線。
        </p>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !label.trim() || !code.trim()}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-accent-600 px-2.5 text-[11px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 aria-hidden className="size-3 animate-spin" />
            ) : (
              <Check aria-hidden className="size-3" />
            )}
            新增
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            disabled={busy}
            className="h-7 rounded-md px-2 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === ADD_SENTINEL) {
            /*
             * 不要讓哨兵值流出去。`<select>` 已經把自己顯示成「新增…」了，所
             * 以要在開面板的同時把它彈回原本的值——否則取消之後，那一格停在
             * 一個不是值的東西上。
             */
            event.target.value = value
            setAdding(true)
            return
          }
          onChange(event.target.value)
        }}
        options={[
          ...(orphan
            ? [{ value, label: `${value}（已從清單移除）` }]
            : []),
          ...options.map((option) => ({ value: option.value, label: `${option.label}（${option.value}）` })),
          ...(canManage && !disabled
            ? [{ value: ADD_SENTINEL, label: `＋ 新增${name}…` }]
            : []),
        ]}
      />

      {/*
        自訂的那幾個才列出來讓人刪。內建的不列——它們刪不掉，而一排不能按的
        叉叉只是噪音。
      */}
      {canManage && !disabled && options.some((option) => !option.builtIn) && (
        <ul className="flex flex-wrap gap-1">
          {options
            .filter((option) => !option.builtIn)
            .map((option) => (
              <li key={option.value}>
                <span className="inline-flex items-center gap-1 rounded-md bg-stage-850 py-0.5 pr-1 pl-1.5 text-[10px] text-ink-400 ring-1 ring-stage-700">
                  {option.label}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => option.id && void remove(option.id, option.label)}
                    aria-label={`刪除${name}「${option.label}」`}
                    className="grid size-3.5 place-items-center rounded transition-colors hover:text-rose-300 disabled:opacity-40"
                  >
                    <X aria-hidden className="size-2.5" />
                  </button>
                </span>
              </li>
            ))}
        </ul>
      )}

      {canManage && !disabled && options.every((option) => option.builtIn) && (
        <p className="inline-flex items-center gap-1 text-[10px] text-ink-700">
          <Plus aria-hidden className="size-2.5" />
          清單裡沒有要的？從下拉最後一項新增。
        </p>
      )}
    </div>
  )
}
