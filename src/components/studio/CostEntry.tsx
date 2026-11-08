'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { EXPENSE_CATEGORY_LABEL } from '@/lib/constants'
import { CURRENCIES, CURRENCY_LABEL } from '@/lib/money'

/**
 * 記一筆帳，以及設一個預算上限 (Z197).
 *
 * 這兩個入口在這之前**不存在**。`expenses` 只有 AI 任務自己記帳與匯入 CSV 兩
 * 個寫入點，而成本頁的空狀態寫著「排一個 AI 任務**或記一筆支出**之後，這裡就
 * 會有數字」；`budgets` 更徹底——三個地方讀它，零個地方寫它，所以規格 §6.7 的
 * 「超支擋下任務」從來沒有生效過。
 *
 * 兩塊都預設收起來。成本頁主要是拿來**看**的，而兩張常駐的表單會把真正要看的
 * 數字擠到下面去。
 */

export type CostEntryProject = { id: string; title: string }

export function CostEntry({
  projects,
  canWrite,
}: {
  projects: CostEntryProject[]
  canWrite: boolean
}) {
  if (projects.length === 0) return null

  return (
    <section className="grid gap-2 lg:grid-cols-2">
      <ExpenseForm projects={projects} canWrite={canWrite} />
      <BudgetForm projects={projects} canWrite={canWrite} />
    </section>
  )
}

/**
 * 把一個預算上限拆掉 (Z197)。
 *
 * 跟表單分開，因為它要出現在每一列預算旁邊而不是在那兩塊折疊面板裡。拆掉是
 * 有後果的——那個範圍從此不再擋任何 AI 任務——所以要先問一次。
 */
export function BudgetRemoveButton({
  projectId,
  budgetId,
  label,
  canWrite,
}: {
  projectId: string
  budgetId: string
  label: string
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  if (!canWrite) return null

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/budgets/${budgetId}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success('移除了', `${label} 不再有上限。`)
      router.refresh()
    } catch (cause) {
      toast.error('移不掉', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  if (asking) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px]">
        <span className="text-ink-500">移除？</span>
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="tap rounded px-1.5 py-0.5 text-rose-300 ring-1 ring-rose-800 transition-colors hover:bg-rose-950 disabled:opacity-50"
        >
          移除
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAsking(false)}
          className="tap rounded px-1.5 py-0.5 text-ink-500 transition-colors hover:text-ink-200"
        >
          算了
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      title="移除這個上限"
      className="tap text-[10px] text-ink-600 transition-colors hover:text-rose-300"
    >
      移除
    </button>
  )
}

/* -------------------------------------------------------------------------- */

function Panel({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-xl bg-stage-900 ring-1 ring-stage-700/60">
      <summary className="tap flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[11px] text-ink-300 transition-colors hover:text-ink-100">
        <span aria-hidden className="text-ink-600 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className="font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-600">{hint}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-stage-700/60 p-3">{children}</div>
    </details>
  )
}

function ExpenseForm({
  projects,
  canWrite,
}: {
  projects: CostEntryProject[]
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    projectId: projects[0]?.id ?? '',
    category: 'OUTSOURCING',
    description: '',
    amount: '',
    currency: 'TWD',
    vendor: '',
    /*
     * 預設今天，而且是**台北的**今天。
     *
     * `toISOString()` 給的是 UTC 的日期，所以台灣時間早上八點前記的帳會落到
     * 前一天。`en-CA` 這個 locale 的格式正好就是 `YYYY-MM-DD`。
     */
    spentAt: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    note: '',
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  async function submit() {
    if (busy) return
    if (!form.description.trim()) {
      toast.error('還差一欄', '請寫一句這筆錢花在哪。')
      return
    }
    if (!/^\d+(\.\d{1,4})?$/.test(form.amount.trim())) {
      toast.error('金額不對', '只能是數字，最多四位小數。')
      return
    }

    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${form.projectId}/expenses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          description: form.description.trim(),
          amount: form.amount.trim(),
          currency: form.currency,
          vendor: form.vendor.trim(),
          spentAt: form.spentAt,
          note: form.note.trim(),
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('記好了', form.description.trim())
      setForm((current) => ({ ...current, description: '', amount: '', vendor: '', note: '' }))
      router.refresh()
    } catch (cause) {
      toast.error('記不進去', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="記一筆支出" hint="外包、授權、軟體訂閱這些手動記的">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="作品">
          <Select
            value={form.projectId}
            disabled={!canWrite || busy}
            onChange={(event) => set('projectId', event.target.value)}
            options={projects.map((project) => ({ value: project.id, label: project.title }))}
          />
        </Field>

        <Field label="類別">
          <Select
            value={form.category}
            disabled={!canWrite || busy}
            onChange={(event) => set('category', event.target.value)}
            options={Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Field>
      </div>

      <Field label="花在哪">
        <Input
          value={form.description}
          maxLength={300}
          disabled={!canWrite || busy}
          placeholder="例如：EP001 配音外包"
          onChange={(event) => set('description', event.target.value)}
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="金額">
          <Input
            value={form.amount}
            inputMode="decimal"
            disabled={!canWrite || busy}
            placeholder="0.00"
            onChange={(event) => set('amount', event.target.value)}
          />
        </Field>

        <Field label="幣別">
          <Select
            value={form.currency}
            disabled={!canWrite || busy}
            onChange={(event) => set('currency', event.target.value)}
            options={CURRENCIES.map((code) => ({ value: code, label: CURRENCY_LABEL[code] }))}
          />
        </Field>

        <Field label="日期">
          <Input
            type="date"
            value={form.spentAt}
            disabled={!canWrite || busy}
            onChange={(event) => set('spentAt', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="付給誰" description="選填">
          <Input
            value={form.vendor}
            maxLength={120}
            disabled={!canWrite || busy}
            onChange={(event) => set('vendor', event.target.value)}
          />
        </Field>

        <Field label="備註" description="選填">
          <Textarea
            value={form.note}
            rows={1}
            maxLength={1000}
            disabled={!canWrite || busy}
            onChange={(event) => set('note', event.target.value)}
          />
        </Field>
      </div>

      {/*
        匯率寫在這裡，因為它是一個會被誤解的欄位：報表上的數字是用**記帳當下**
        的匯率換算的，不是今天的。
      */}
      <p className="text-[10px] leading-relaxed text-ink-600">
        換算用的匯率會在記帳當下存下來，之後匯率變了這一筆也不會跟著變。
      </p>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={submit}
          loading={busy}
          disabled={!canWrite || busy}
          title={canWrite ? undefined : '你的角色不能記帳'}
        >
          記下來
        </Button>
      </div>
    </Panel>
  )
}

function BudgetForm({ projects, canWrite }: { projects: CostEntryProject[]; canWrite: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    projectId: projects[0]?.id ?? '',
    category: '',
    period: '',
    amount: '',
    currency: 'TWD',
    alertThresholdPct: '80',
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  async function submit() {
    if (busy) return
    if (!/^\d+(\.\d{1,4})?$/.test(form.amount.trim()) || Number(form.amount) <= 0) {
      toast.error('上限不對', '要是一個大於 0 的數字。')
      return
    }

    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${form.projectId}/budgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: form.category || null,
          period: form.period || null,
          amount: form.amount.trim(),
          currency: form.currency,
          alertThresholdPct: Number(form.alertThresholdPct) || 80,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('設好了', '超過上限的 AI 任務會被擋下來。')
      router.refresh()
    } catch (cause) {
      toast.error('設不進去', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="設一個預算上限" hint="設了之後，超支的 AI 任務會被擋下來">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="作品">
          <Select
            value={form.projectId}
            disabled={!canWrite || busy}
            onChange={(event) => set('projectId', event.target.value)}
            options={projects.map((project) => ({ value: project.id, label: project.title }))}
          />
        </Field>

        <Field label="類別" description="不選就是整個作品一起算">
          <Select
            value={form.category}
            disabled={!canWrite || busy}
            onChange={(event) => set('category', event.target.value)}
            options={[
              { value: '', label: '全部類別' },
              ...Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="上限">
          <Input
            value={form.amount}
            inputMode="decimal"
            disabled={!canWrite || busy}
            placeholder="0.00"
            onChange={(event) => set('amount', event.target.value)}
          />
        </Field>

        <Field label="幣別">
          <Select
            value={form.currency}
            disabled={!canWrite || busy}
            onChange={(event) => set('currency', event.target.value)}
            options={CURRENCIES.map((code) => ({ value: code, label: CURRENCY_LABEL[code] }))}
          />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="期間" description="空白＝不分月份，一路累計">
          <Input
            type="month"
            value={form.period}
            disabled={!canWrite || busy}
            onChange={(event) => set('period', event.target.value)}
          />
        </Field>

        <Field label="警示門檻（%）" description="用到幾成的時候開始提醒">
          <Input
            type="number"
            min={1}
            max={100}
            value={form.alertThresholdPct}
            disabled={!canWrite || busy}
            onChange={(event) => set('alertThresholdPct', event.target.value)}
          />
        </Field>
      </div>

      {/*
        這一句不是客套話：設下去之後 `assertWithinBudget` 會真的擋住排程，而
        「我的 AI 任務怎麼都跑不動」是一個很難自己查出來的症狀。
      */}
      <p className="text-[10px] leading-relaxed text-amber-300/80">
        設下去之後，本期花費超過上限的 AI 任務會**排不進去**並說明原因。同一個範圍再設一次
        就是改掉它。
      </p>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={submit}
          loading={busy}
          disabled={!canWrite || busy}
          title={canWrite ? undefined : '你的角色不能設定預算'}
        >
          設定上限
        </Button>
      </div>
    </Panel>
  )
}
