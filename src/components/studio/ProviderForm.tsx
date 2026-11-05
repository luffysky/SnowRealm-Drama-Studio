'use client'

import { ListChecks, Loader2, Plus, Wifi } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { VENDORS, vendorById } from '@/lib/ai/vendors'
import {
  AI_PROVIDER_KIND_LABEL,
  AI_PROVIDER_KINDS,
  type AiProviderKindValue,
} from '@/lib/constants'

/**
 * 新增 AI 供應商，以及測試它 (Z146).
 *
 * `POST /api/ai/providers` 跟 `POST /api/ai/providers/[id]/test` 兩支端點
 * 寫好了很久，**介面上沒有任何地方叫得到**。結果是資料表裡一筆供應商都沒有
 * ——所以 AI 一直是靠環境變數裡的 `ANTHROPIC_API_KEY` 在跑，而那正是製片
 * 中心上面那句「能用，但換金鑰要重新部署」的由來。
 *
 * 那句話不是限制，是**沒接線的症狀**：後端早就能存一把加密的金鑰了。
 *
 * ## 金鑰的方向是單向的
 *
 * 打上去的明文往伺服器走，加密存起來，**從此不會再回來**——回來的只有後四
 * 碼，夠分辨兩把金鑰，不夠拿去用。所以這個表單沒有「編輯金鑰」，只有重新
 * 填一次；想顯示現有的金鑰讓人改，就得把它解密送回瀏覽器，那是在用方便
 * 交換一個洩漏的機會。
 *
 * ## 不是每一種都真的能跑
 *
 * 四種 kind 都存得進資料庫，但只有 `ANTHROPIC` 有適配器；另外三種
 * `adapterFor()` 一律回 `null`。所以選到那幾種時**先講出來**，而不是讓人
 * 填完、存好、看起來成功，然後在排任務的時候才發現它不會動。
 */

/**
 * 真的接得上的種類。
 *
 * `OPENAI_COMPATIBLE` 一種就涵蓋 GPT、Gemini、DeepSeek、Kimi、千問、GLM、
 * OpenRouter——它們都提供 OpenAI 相容的 `/chat/completions` (Z151)。
 * 圖片／影片／語音那三種還是 enum 裡的位置，不是能用的東西。
 */
const IMPLEMENTED = new Set<AiProviderKindValue>(['ANTHROPIC', 'OPENAI_COMPATIBLE'])

export function AddProvider({ models }: { models: readonly string[] }) {
  const router = useRouter()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [kind, setKind] = useState<AiProviderKindValue>('ANTHROPIC')
  /** 選了哪一家。空字串代表自己填 base URL (Z151)。 */
  const [vendorId, setVendorId] = useState('')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState(models[0] ?? '')
  const [envVarName, setEnvVarName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [enabled, setEnabled] = useState(true)

  const implemented = IMPLEMENTED.has(kind)
  const chosenVendor = vendorId ? vendorById(vendorId) : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    try {
      const response = await apiFetch('/api/ai/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          label: label.trim(),
          defaultModel: defaultModel.trim(),
          // 空的就不要送——schema 要求至少 8 個字，送空字串會被擋下來。
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          envVarName: envVarName.trim(),
          baseUrl: baseUrl.trim(),
          enabled,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(
        `已新增「${label.trim()}」`,
        implemented ? '可以按「測試連線」確認金鑰。' : '這類供應商還沒有適配器，暫時不會跑任務。'
      )

      // 金鑰不留在記憶體裡，也不留在輸入框裡。
      setApiKey('')
      setLabel('')
      setOpen(false)
      router.refresh()
    } catch (cause) {
      toast.error('新增失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap inline-flex w-fit items-center gap-1.5 rounded-lg bg-stage-800 px-3 py-1.5 text-[11px] text-ink-200 transition-colors hover:text-ink-50"
      >
        <Plus aria-hidden className="size-3.5" />
        新增供應商
      </button>
    )
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2.5 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-400">類型</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AiProviderKindValue)}
            className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          >
            {AI_PROVIDER_KINDS.map((value) => (
              <option key={value} value={value}>
                {AI_PROVIDER_KIND_LABEL[value]}
                {IMPLEMENTED.has(value) ? '' : '（尚無適配器）'}
              </option>
            ))}
          </select>
        </label>

        {/*
          * 挑廠商，把 base URL 填好 (Z151).
          *
          * 不讓人手打 base URL：打錯的結果是一個永遠連不上的供應商，而錯誤
          * 訊息只會說「連不上」。下拉裡每一個網址都實際請求驗證過。
          */}
        {kind === 'OPENAI_COMPATIBLE' && (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[10px] text-ink-400">哪一家</span>
            <select
              value={vendorId}
              onChange={(event) => {
                const picked = vendorById(event.target.value)
                setVendorId(event.target.value)
                if (!picked) return
                setBaseUrl(picked.baseUrl)
                setEnvVarName(picked.envVarName)
                if (!label.trim()) setLabel(picked.label)
                setDefaultModel('')
              }}
              className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              <option value="">自己填 base URL</option>
              {VENDORS.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.label}
                </option>
              ))}
            </select>
            {chosenVendor && (
              <span className="text-[10px] leading-relaxed text-ink-600">
                {chosenVendor.note}
                {' '}
                金鑰在{' '}
                <a
                  href={chosenVendor.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-ink-300"
                >
                  {chosenVendor.keyUrl}
                </a>
                {!chosenVendor.listsModels && '　這一家列不出模型清單，模型名要自己填。'}
              </span>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-400">名稱</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={60}
            placeholder="例如：Claude（正式）"
            className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-400">API 金鑰</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            minLength={8}
            maxLength={300}
            autoComplete="off"
            placeholder="留空則沿用環境變數"
            className="h-8 rounded-lg bg-stage-850 px-2 font-mono text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-400">預設模型</span>
          {kind === 'ANTHROPIC' && models.length > 0 ? (
            <select
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
              className="h-8 rounded-lg bg-stage-850 px-2 font-mono text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
              maxLength={80}
              className="h-8 rounded-lg bg-stage-850 px-2 font-mono text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-400">環境變數名稱（選填）</span>
          <input
            value={envVarName}
            onChange={(event) => setEnvVarName(event.target.value)}
            maxLength={80}
            placeholder="ANTHROPIC_API_KEY"
            className="h-8 rounded-lg bg-stage-850 px-2 font-mono text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-400">Base URL（選填）</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://…"
            className="h-8 rounded-lg bg-stage-850 px-2 font-mono text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-ink-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-3.5 accent-accent-500"
        />
        立刻啟用
      </label>

      {/*
       * 先講出來，不要讓人填完才發現。選到沒有適配器的類型時，存得進資料庫
       * 但不會跑任何任務——那種「看起來成功」比直接擋下來難查得多。
       */}
      {!implemented && (
        <p className="text-[10px] leading-relaxed text-amber-400/80">
          {AI_PROVIDER_KIND_LABEL[kind]}還沒有適配器，存得起來但不會跑任務。
          現在只有 Claude（文字）接得上。
        </p>
      )}

      {/* JSX 裡沒有 markdown：`**粗體**` 會原樣印出兩顆星號。要強調就用 span。 */}
      <p className="text-[10px] leading-relaxed text-ink-600">
        金鑰加密存在伺服器，<span className="text-ink-400">不會</span>再回到瀏覽器
        ——之後只看得到後四碼。要換就重新填一次。
      </p>

      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={saving || !label.trim()}
          className="tap inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-[11px] text-white transition-colors hover:bg-accent-500 disabled:opacity-40"
        >
          {saving && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
          {saving ? '儲存中…' : '新增'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="tap rounded-lg px-3 py-1.5 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          取消
        </button>
      </div>
    </form>
  )
}

/**
 * 跟廠商要可用的模型清單 (Z151).
 *
 * 沒有這顆鈕，模型指派那一頁的下拉永遠是空的——而寫死一份清單會在某天變成
 * 「選單裡有、打過去 404」。問廠商拿到的才是**這個帳號當下真的能用的**。
 *
 * Gemini 的相容層沒有 `/models`（實測 404）。那不是故障，所以回來的訊息會
 * 直說要手動填，不是報一個錯。
 */
export function FetchModels({ providerId }: { providerId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function fetchModels() {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/ai/providers/${providerId}/models`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as {
        data?: { fetched?: boolean; models?: string[]; reason?: string }
      } & { fetched?: boolean; models?: string[]; reason?: string }
      const result = body.data ?? body

      if (result.fetched) {
        toast.success(`抓到 ${result.models?.length ?? 0} 個模型`, '現在可以到「模型」那一頁指派了。')
        router.refresh()
      } else {
        toast.info('沒有抓到清單', result.reason ?? '這一家沒有提供模型清單端點。')
      }
    } catch (cause) {
      toast.error('抓不到', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void fetchModels()}
      disabled={busy}
      className="tap inline-flex w-fit items-center gap-1 rounded-lg bg-stage-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:text-ink-50 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3 animate-spin" />
      ) : (
        <ListChecks aria-hidden className="size-3" />
      )}
      抓取可用模型
    </button>
  )
}

/**
 * 測試連線。
 *
 * 做的是**真的一次最小呼叫**，不是 ping——金鑰格式對但沒有額度、模型名稱
 * 打錯、區域不對，這幾種只有真的送一次才知道。結果會寫回那一列，所以下次
 * 打開頁面還看得到上次測的時候發生什麼事。
 */
export function TestProvider({ providerId }: { providerId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [testing, setTesting] = useState(false)

  async function test() {
    if (testing) return
    setTesting(true)
    try {
      const response = await apiFetch(`/api/ai/providers/${providerId}/test`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { data?: { ok: boolean; message: string } } & {
        ok?: boolean
        message?: string
      }
      const result = body.data ?? (body as { ok: boolean; message: string })

      if (result.ok) toast.success('連得上', result.message)
      else toast.error('連不上', result.message)

      router.refresh()
    } catch (cause) {
      toast.error('測試失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setTesting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void test()}
      disabled={testing}
      className="tap inline-flex w-fit items-center gap-1 rounded-lg bg-stage-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:text-ink-50 disabled:opacity-40"
    >
      {testing ? (
        <Loader2 aria-hidden className="size-3 animate-spin" />
      ) : (
        <Wifi aria-hidden className="size-3" />
      )}
      測試連線
    </button>
  )
}
