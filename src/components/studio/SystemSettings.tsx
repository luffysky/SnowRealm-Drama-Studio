'use client'

import { Check, Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { TASK_EFFORT } from '@/lib/ai/prompts'
import { HealthPanel } from '@/components/studio/HealthPanel'
import { CURRENCIES, CURRENCY_LABEL, type CurrencyValue, type FxRates } from '@/lib/money'
import { AI_EFFORTS, type AiEffort, type IceServer, type ModelPricing, type StorageCost, type TaskProfiles } from '@/lib/settings-view'
import { cn } from '@/lib/utils'

/**
 * 系統設定 (Z87).
 *
 * One page, several independent forms. Each section saves on its own rather
 * than one 儲存 button for the lot: these are unrelated numbers, and a single
 * save that writes all five means a typo in the TURN password refuses to save
 * a corrected exchange rate.
 *
 * Every section says where its number came from and when. A rate with no date
 * beside it is indistinguishable from a rate that stopped being true a year
 * ago.
 */

type Props = {
  canEdit: boolean
  fx: FxRates
  storage: StorageCost
  storageDefault: StorageCost
  pricing: ModelPricing
  builtInPricing: ModelPricing
  profiles: TaskProfiles
  defaultModel: string
  ice: IceServer[]
  tasks: { kind: string; label: string }[]
}

export function SystemSettings(props: Props) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-medium text-ink-50">系統設定</h1>
        <p className="text-[11px] leading-relaxed text-ink-500">
          這裡放的是<strong className="text-ink-300">會變、而且變了之後算出來的東西就是錯的</strong>
          數字。單純是決定的常數留在程式裡，那裡才有寫為什麼。
        </p>
      </header>

      {!props.canEdit && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 ring-1 ring-amber-500/30">
          你的角色不能改這些設定，只能看。
        </p>
      )}

      <FxSection rates={props.fx} canEdit={props.canEdit} />
      <StorageSection cost={props.storage} fallback={props.storageDefault} canEdit={props.canEdit} />
      <PricingSection
        pricing={props.pricing}
        builtIn={props.builtInPricing}
        canEdit={props.canEdit}
      />
      <TasksSection
        profiles={props.profiles}
        tasks={props.tasks}
        defaultModel={props.defaultModel}
        canEdit={props.canEdit}
      />
      <IceSection servers={props.ice} canEdit={props.canEdit} />

      {/*
        沒有用 `Section` 包：那個元件的骨架是「改東西 → 儲存」，而這一塊什麼
        都不存。硬套會多出一顆永遠按不下去的儲存鈕——這個專案最不該出現的東西。
      */}
      <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700/60">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium text-ink-100">系統健康</h2>
          <p className="text-[10px] leading-relaxed text-ink-500">
            失敗與卡死的任務、匯率有沒有在更新、鎖住沒解的內容、本月花費。
            每天早上的排程打的是同一支 API，所以這裡看到的就是它會回報的。
          </p>
        </div>
        <HealthPanel />
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  why,
  children,
  onSave,
  canEdit,
  dirty,
}: {
  title: string
  /** What goes wrong if this number is stale. Not decoration. */
  why: string
  children: ReactNode
  onSave: () => Promise<void>
  canEdit: boolean
  dirty: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await onSave()
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700/60">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-ink-100">{title}</h2>
        <p className="text-[10px] leading-relaxed text-ink-500">{why}</p>
      </div>

      {children}

      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="tap inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-500 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 aria-hidden className="size-3 animate-spin" />
            ) : saved ? (
              <Check aria-hidden className="size-3" />
            ) : null}
            {saved ? '已儲存' : '儲存'}
          </button>
          {dirty && !saving && <span className="text-[10px] text-amber-300">有未儲存的變更</span>}
        </div>
      )}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-ink-400">
        {label}
        {hint && <span className="ml-1.5 text-ink-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputClass =
  'rounded-lg bg-stage-850 px-2.5 py-1.5 text-[12px] text-ink-100 ring-1 ring-stage-700 transition-colors placeholder:text-ink-600 focus:ring-accent-500/60 focus:outline-none disabled:opacity-50'

/** The one place a save turns into a toast, so every section reads the same. */
function useSaver() {
  const toast = useToast()

  return async function put(url: string, body: unknown, what: string) {
    const response = await apiFetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const message = await readApiError(response)
      toast.error(`${what}存不起來`, message)
      throw new Error(message)
    }
    toast.success(`${what}已更新`)
  }
}

/* -------------------------------------------------------------------------- */
/* 匯率                                                                         */
/* -------------------------------------------------------------------------- */

function FxSection({ rates, canEdit }: { rates: FxRates; canEdit: boolean }) {
  const put = useSaver()
  const [draft, setDraft] = useState(rates)
  const dirty = JSON.stringify(draft) !== JSON.stringify(rates)

  return (
    <Section
      title="匯率"
      why="每一筆用外幣記的花費都換算成這個基準幣別。匯率過期，成本頁上的每個總計就都是錯的——而畫面上看不出來。"
      canEdit={canEdit}
      dirty={dirty}
      onSave={() => put('/api/settings/fx', draft, '匯率')}
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="基準幣別" hint="其他幣別都換算成它">
          <select
            value={draft.base}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, base: e.target.value as CurrencyValue })}
            className={inputClass}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABEL[c]}（{c}）
              </option>
            ))}
          </select>
        </Field>

        <Field label="取得日期" hint="顯示在換算後的數字旁邊">
          <input
            type="date"
            value={draft.asOf.slice(0, 10)}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, asOf: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {CURRENCIES.map((currency) => (
          <Field
            key={currency}
            label={`1 ${draft.base} = ? ${currency}`}
            hint={currency === draft.base ? '基準' : undefined}
          >
            <input
              type="number"
              step="0.0001"
              min="0"
              value={draft.rates[currency] ?? ''}
              disabled={!canEdit || currency === draft.base}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  rates: { ...draft.rates, [currency]: Number(e.target.value) },
                })
              }
              className={cn(inputClass, 'tabular-nums')}
            />
          </Field>
        ))}
      </div>

      <Field label="來源" hint="之後要查「這個數字哪來的」靠它">
        <input
          value={draft.source}
          disabled={!canEdit}
          placeholder="例：台灣銀行牌告匯率"
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
          className={inputClass}
        />
      </Field>

      {canEdit && <FetchRatesButton />}
    </Section>
  )
}

/**
 * 立刻去抓一次匯率 (Z150).
 *
 * 每天一次是搭既有的排程跑的（Vercel Hobby 一個專案只有兩個排程，都用掉
 * 了）。但一天一次代表「現在就想看到正確數字」沒有辦法——所以這顆鈕。
 *
 * 抓壞了不會寫進去。驗證在 `fx-fetch.ts`：三種幣別齊全、基準對自己是 1、
 * 數字在合理範圍。匯率錯了比匯率舊了糟糕得多。
 */
function FetchRatesButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function fetchNow() {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch('/api/cron/fx', { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as {
        data?: { updated?: boolean; reason?: string; rates?: { asOf?: string } }
      } & { updated?: boolean; reason?: string; rates?: { asOf?: string } }
      const result = body.data ?? body

      if (result.updated) {
        toast.success('匯率更新了', `取得日期 ${result.rates?.asOf ?? ''}`)
        router.refresh()
      } else {
        // 「沒更新」不是失敗，但理由要講出來。
        toast.info('沒有更新', result.reason ?? '跟現有的一樣')
      }
    } catch (cause) {
      toast.error('抓不到匯率', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t border-stage-800 pt-3">
      <button
        type="button"
        onClick={() => void fetchNow()}
        disabled={busy}
        className="tap inline-flex w-fit items-center gap-1.5 rounded-lg bg-stage-800 px-3 py-1.5 text-[11px] text-ink-200 transition-colors hover:text-ink-50 disabled:opacity-40"
      >
        {busy ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-3.5" />
        )}
        {busy ? '抓取中…' : '立刻抓一次最新匯率'}
      </button>
      <p className="text-[10px] leading-relaxed text-ink-700">
        來源 open.er-api.com（免費、不需金鑰、有台幣）。每天會自動抓一次；
        抓回來的數字不合理就不會寫進去。
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* R2 儲存費率                                                                  */
/* -------------------------------------------------------------------------- */

function StorageSection({
  cost,
  fallback,
  canEdit,
}: {
  cost: StorageCost
  fallback: StorageCost
  canEdit: boolean
}) {
  const put = useSaver()
  const [draft, setDraft] = useState(cost)
  const dirty = JSON.stringify(draft) !== JSON.stringify(cost)

  return (
    <Section
      title="儲存費率（Cloudflare R2）"
      why="素材的儲存成本都是從這個單價乘出來的。Cloudflare 改價之後這裡沒跟著改，成本估算就會一路錯下去。"
      canEdit={canEdit}
      dirty={dirty}
      onSave={() => put('/api/settings/storage', draft, '儲存費率')}
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="每 GB 每月（USD）">
          <input
            type="number"
            step="0.001"
            min="0"
            value={draft.usdPerGbMonth}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, usdPerGbMonth: Number(e.target.value) })}
            className={cn(inputClass, 'tabular-nums')}
          />
        </Field>

        <Field label="免費額度（GB）">
          <input
            type="number"
            step="1"
            min="0"
            value={draft.freeTierGb}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, freeTierGb: Number(e.target.value) })}
            className={cn(inputClass, 'tabular-nums')}
          />
        </Field>

        <Field label="取得日期">
          <input
            type="date"
            value={draft.asOf.slice(0, 10)}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, asOf: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="來源">
          <input
            value={draft.source}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      {canEdit && JSON.stringify(draft) !== JSON.stringify(fallback) && (
        <button
          type="button"
          onClick={() => setDraft(fallback)}
          className="tap inline-flex w-fit items-center gap-1 text-[10px] text-ink-500 hover:text-ink-200"
        >
          <RotateCcw aria-hidden className="size-3" />
          回到內建的公告價
        </button>
      )}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 模型單價                                                                     */
/* -------------------------------------------------------------------------- */

function PricingSection({
  pricing,
  builtIn,
  canEdit,
}: {
  pricing: ModelPricing
  builtIn: ModelPricing
  canEdit: boolean
}) {
  const put = useSaver()
  const [draft, setDraft] = useState(pricing)
  const dirty = JSON.stringify(draft) !== JSON.stringify(pricing)

  const models = Object.keys(draft).sort()

  function edit(model: string, field: 'input' | 'output' | 'cacheRead', value: number) {
    const row = draft[model]
    if (!row) return
    setDraft({ ...draft, [model]: { ...row, [field]: value } })
  }

  return (
    <Section
      title="模型單價"
      why="每百萬 token 的美金價。AI 的每一筆花費都是用這張表算出來的；Anthropic 調價之後沒跟著改，帳就是假的。"
      canEdit={canEdit}
      dirty={dirty}
      onSave={() => put('/api/settings/models', { pricing: draft }, '模型單價')}
    >
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-[11px]">
          <thead>
            <tr className="text-left text-[10px] text-ink-600">
              <th className="px-1 pb-1 font-normal">模型</th>
              <th className="px-1 pb-1 text-right font-normal">輸入</th>
              <th className="px-1 pb-1 text-right font-normal">輸出</th>
              <th className="px-1 pb-1 text-right font-normal">快取讀取</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const row = draft[model]!
              const base = builtIn[model]
              const changed =
                base &&
                (base.input !== row.input ||
                  base.output !== row.output ||
                  base.cacheRead !== row.cacheRead)

              return (
                <tr key={model} className="border-t border-stage-800">
                  <td className="px-1 py-1.5">
                    <span className="font-mono text-[10px] text-ink-200">{model}</span>
                    {changed && (
                      <span className="ml-1.5 text-[9px] text-amber-300" title="跟內建值不同">
                        已改
                      </span>
                    )}
                  </td>
                  {(['input', 'output', 'cacheRead'] as const).map((field) => (
                    <td key={field} className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row[field]}
                        disabled={!canEdit}
                        onChange={(e) => edit(model, field, Number(e.target.value))}
                        className={cn(inputClass, 'w-full text-right tabular-nums')}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={() => setDraft(builtIn)}
          className="tap inline-flex w-fit items-center gap-1 text-[10px] text-ink-500 hover:text-ink-200"
        >
          <RotateCcw aria-hidden className="size-3" />
          全部回到內建價目
        </button>
      )}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* AI 任務設定                                                                  */
/* -------------------------------------------------------------------------- */

const EFFORT_LABEL: Record<AiEffort, string> = {
  low: '快，省',
  medium: '中等',
  high: '慢，想久一點',
}

function TasksSection({
  profiles,
  tasks,
  defaultModel,
  canEdit,
}: {
  profiles: TaskProfiles
  tasks: { kind: string; label: string }[]
  defaultModel: string
  canEdit: boolean
}) {
  const put = useSaver()
  const [draft, setDraft] = useState<TaskProfiles>(profiles)
  const dirty = JSON.stringify(draft) !== JSON.stringify(profiles)

  /**
   * 這個任務沒設定的時候，實際會用的思考程度。
   *
   * 下拉顯示的也是它——顯示 'medium' 而實際跑 high，那個下拉就是在說謊。
   */
  function builtInEffort(kind: string): AiEffort {
    const built = TASK_EFFORT[kind as keyof typeof TASK_EFFORT]
    return built === 'low' || built === 'medium' || built === 'high' ? built : 'medium'
  }

  function set(
    kind: string,
    patch: Partial<{ effort: AiEffort; model: string; maxTokens: string }>
  ) {
    /*
     * 新建一列的時候用**這個任務自己的內建值**，不是 'medium' (Z160).
     *
     * 本來寫死 `{ effort: 'medium' }`，於是一個還沒有設定列的任務，只要你去
     * 調它的輸出上限，就會順手被寫下 `effort: 'medium'`——而 `PROJECT_PLAN`、
     * `NOVEL_REVIEW`、`WORLD_CONSISTENCY` 這些內建是 high，`NOVEL_POLISH`、
     * `ASSET_GENERATE` 內建是 low。**只調上限會悄悄改掉思考程度**。
     *
     * 而錯誤訊息正是叫使用者來動這一欄。
     */
    const current = draft[kind] ?? { effort: builtInEffort(kind) }
    const next: TaskProfiles[string] = { ...current }

    if (patch.effort) next.effort = patch.effort
    if (patch.model !== undefined) next.model = patch.model

    /*
     * 空白代表「用預設」，不是 0 (Z157).
     *
     * 存成 0 的話每一次呼叫都會立刻失敗，而那個 0 在這一欄看起來只是一個
     * 數字。所以清空就是把這個欄位拿掉。
     */
    if (patch.maxTokens !== undefined) {
      const parsed = Number(patch.maxTokens)
      if (patch.maxTokens.trim() && Number.isFinite(parsed) && parsed > 0) {
        next.maxTokens = Math.floor(parsed)
      } else {
        delete next.maxTokens
      }
    }

    if (!next.model?.trim()) delete next.model
    setDraft({ ...draft, [kind]: next })
  }

  return (
    <Section
      title="AI 任務設定"
      why="每個任務用哪個模型、想多久、最多寫多長。輸出上限是**思考加正文的總額**——給太小的話，模型會把額度全部花在思考上然後一個字都沒寫（Z157 就是這樣壞的）。留白就是用內建值。"
      canEdit={canEdit}
      dirty={dirty}
      onSave={() => put('/api/settings/tasks', { profiles: draft }, 'AI 任務設定')}
    >
      <div className="flex flex-col gap-1.5">
        {tasks.map(({ kind, label }) => {
          const row = draft[kind]
          return (
            <div
              key={kind}
              className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-stage-800 py-1.5 first:border-0 sm:grid-cols-[1fr_7rem_6rem_9rem]"
            >
              <span className="min-w-0 truncate text-[11px] text-ink-300">{label}</span>

              <select
                value={row?.effort ?? builtInEffort(kind)}
                disabled={!canEdit}
                aria-label={`${label} 的思考程度`}
                onChange={(e) => set(kind, { effort: e.target.value as AiEffort })}
                className={cn(inputClass, 'text-[10px]')}
              >
                {AI_EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {EFFORT_LABEL[effort]}
                  </option>
                ))}
              </select>

              {/*
                輸出上限 (Z157)。錯誤訊息一直叫人「在系統設定把輸出上限調
                高」，而這一欄在今天之前**不存在**——只有思考程度。一個指著
                不存在的控制項的錯誤訊息，比沒有建議更糟。
              */}
              <input
                type="number"
                min={256}
                max={64000}
                step={1000}
                value={row?.maxTokens ?? ''}
                disabled={!canEdit}
                aria-label={`${label} 的輸出上限`}
                placeholder="預設"
                onChange={(e) => set(kind, { maxTokens: e.target.value })}
                className={cn(inputClass, 'text-[10px] tabular-nums')}
              />

              <input
                value={row?.model ?? ''}
                disabled={!canEdit}
                aria-label={`${label} 的模型`}
                placeholder={defaultModel}
                onChange={(e) => set(kind, { model: e.target.value })}
                className={cn(inputClass, 'col-span-2 font-mono text-[10px] sm:col-span-1')}
              />
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 通話伺服器                                                                   */
/* -------------------------------------------------------------------------- */

function IceSection({ servers, canEdit }: { servers: IceServer[]; canEdit: boolean }) {
  const put = useSaver()
  const [draft, setDraft] = useState<IceServer[]>(servers)
  const dirty = JSON.stringify(draft) !== JSON.stringify(servers)

  return (
    <Section
      title="通話伺服器（STUN／TURN）"
      why="兩個家用網路之間 STUN 就夠了。穿不過去的時候才需要 TURN 中繼，而那要錢，所以不預設開。"
      canEdit={canEdit}
      dirty={dirty}
      onSave={() => put('/api/settings/ice', { servers: draft }, '通話伺服器')}
    >
      <div className="flex flex-col gap-2">
        {draft.map((server, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-lg bg-stage-850 p-2.5 ring-1 ring-stage-700/60"
          >
            <Field label="網址" hint="一行一個">
              <textarea
                rows={2}
                value={server.urls.join('\n')}
                disabled={!canEdit}
                placeholder="stun:stun.l.google.com:19302"
                onChange={(e) => {
                  const next = [...draft]
                  next[index] = {
                    ...server,
                    urls: e.target.value.split('\n').map((u) => u.trim()).filter(Boolean),
                  }
                  setDraft(next)
                }}
                className={cn(inputClass, 'resize-y font-mono text-[10px]')}
              />
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="使用者名稱" hint="STUN 不用填">
                <input
                  value={server.username ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = [...draft]
                    next[index] = { ...server, username: e.target.value }
                    setDraft(next)
                  }}
                  className={inputClass}
                />
              </Field>

              <Field label="密碼">
                <input
                  type="password"
                  value={server.credential ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = [...draft]
                    next[index] = { ...server, credential: e.target.value }
                    setDraft(next)
                  }}
                  className={inputClass}
                />
              </Field>
            </div>

            {canEdit && draft.length > 1 && (
              <button
                type="button"
                onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                className="tap inline-flex w-fit items-center gap-1 text-[10px] text-ink-600 hover:text-rose-300"
              >
                <Trash2 aria-hidden className="size-3" />
                移除這一台
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={() => setDraft([...draft, { urls: [] }])}
          className="tap inline-flex w-fit items-center gap-1 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[10px] text-ink-300 hover:bg-stage-700"
        >
          <Plus aria-hidden className="size-3" />
          加一台
        </button>
      )}

      <p className="text-[10px] leading-relaxed text-ink-600">
        Cloudflare TURN 不填在這裡——它的長期金鑰只留在伺服器端（
        <span className="font-mono">CLOUDFLARE_TURN_KEY_ID</span>／
        <span className="font-mono">CLOUDFLARE_TURN_API_TOKEN</span>
        ），瀏覽器拿到的是後端臨時簽發的短期憑證。見 <span className="font-mono">docs/CALLS.md</span>。
      </p>
    </Section>
  )
}
