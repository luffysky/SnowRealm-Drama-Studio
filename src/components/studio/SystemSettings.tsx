'use client'

import { Check, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
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
    </Section>
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

  function set(kind: string, patch: Partial<{ effort: AiEffort; model: string }>) {
    const current = draft[kind] ?? { effort: 'medium' as AiEffort }
    const next = { ...current, ...patch }
    if (!next.model?.trim()) delete next.model
    setDraft({ ...draft, [kind]: next })
  }

  return (
    <Section
      title="AI 任務設定"
      why="每個任務用哪個模型、想多久。內建值是還沒有任何用量可以判斷之前訂的，所以本來就該能改。留白就是用預設模型。"
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
              className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-stage-800 py-1.5 first:border-0 sm:grid-cols-[1fr_8rem_10rem]"
            >
              <span className="min-w-0 truncate text-[11px] text-ink-300">{label}</span>

              <select
                value={row?.effort ?? 'medium'}
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
