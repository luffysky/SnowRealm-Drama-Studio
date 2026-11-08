import { Wallet } from 'lucide-react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EmptyState } from '@/components/ui/StateViews'
import { BudgetRemoveButton, CostEntry } from '@/components/studio/CostEntry'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { costOverview, type CostByGroup } from '@/lib/costs'
import { listProjects } from '@/lib/projects'
import { conversionNote, formatMoney } from '@/lib/money'
import { getFxRates } from '@/lib/settings'
import { cn, formatRelativeZh } from '@/lib/utils'

export const metadata: Metadata = { title: '成本中心' }

/**
 * 成本中心 (Z90).
 *
 * 側邊欄上掛著這一項、標著 M3，但這個畫面從來沒有做出來——而三張資料表
 * 早就在收資料了。做出來的第一天就有東西可看，因為錢一直在花。
 *
 * ## 分成三欄不是為了好看
 *
 * **已實際發生**是結算完的，**已承諾**是排下去還沒結算的，**手動記錄**是
 * 外包、授權那些人自己輸入的。三個混在一起會得到一個沒有人能解釋的數字：
 * 已承諾的那部分可能永遠不會發生（任務取消），而手動記錄的那部分已經付掉
 * 了。放在一起看，但要分得出來。
 *
 * 伺服器元件，第一次繪製就是真的數字。一頁統計如果先空白再填進來，第二次
 * 看的時候就不會相信它。
 */
export default async function CostsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const fx = await getFxRates()
  const [overview, projectList] = await Promise.all([
    costOverview({ currency: user.displayCurrency, fx }),
    /*
     * 表單要的是**全部**看得到的作品，不是有花費紀錄的那幾個 (Z197)。
     * `overview.byProject` 只列已經有帳的，而第一筆帳正是要記進一個還沒有帳
     * 的作品。
     */
    listProjects(user.id),
  ])
  const canWrite = can(user, 'expense.write')
  const projects = projectList.cards.map((card) => ({ id: card.id, title: card.title }))

  const money = (amount: number) => formatMoney(amount, overview.totals.currency)
  const note = conversionNote(overview.totals.currency, fx)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Wallet aria-hidden className="size-4 text-accent-400" />
          成本中心
        </h2>
        <p className="text-[11px] text-ink-500">
          跨作品的花費。AI 與儲存是按用量記的，外包與授權是手動記的。
        </p>
        {note && <span className="ml-auto text-[10px] text-ink-700">{note}</span>}
      </header>

      <CostEntry projects={projects} canWrite={canWrite} />

      {!overview.hasData ? (
        <EmptyState
          title="還沒有任何花費紀錄"
          description="排一個 AI 任務，或用上面的「記一筆支出」手動記一筆。"
        />
      ) : (
        <>
          {/* ---- 三個總額 ------------------------------------------------ */}
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="已實際發生" value={money(overview.totals.actual)} tone="solid" />
            <Tile
              label="已承諾未結算"
              value={money(overview.totals.committed)}
              hint="排下去了，還沒結算"
            />
            <Tile label="手動記錄" value={money(overview.totals.manual)} hint="外包、授權、軟體" />
            <Tile label="合計" value={money(overview.totals.total)} tone="accent" />
          </section>

          {/* ---- 預算 ---------------------------------------------------- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-medium text-ink-300">預算</h3>
            {overview.budgets.length === 0 ? (
              /*
               * 沒有預算就說沒有，不要畫一條假的進度條。
               *
               * 一條對著想像中的上限畫的進度條，會讓人以為有人設過這個數字。
               */
              <p className="rounded-lg bg-stage-900 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500 ring-1 ring-stage-700/60">
                還沒有設定任何預算上限，所以沒有東西可以對照。用上面的「設一個預算上限」設一個，
                這裡就會顯示用掉多少、什麼時候該停——而超過上限的 AI 任務會被擋下來。
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {overview.budgets.map((budget) => (
                  <li
                    key={budget.id}
                    className="flex flex-col gap-1 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                      <span className="text-ink-100">{budget.projectTitle}</span>
                      {budget.category && (
                        <span className="text-[10px] text-ink-600">{budget.category}</span>
                      )}
                      {budget.period && (
                        <span className="text-[10px] text-ink-600">{budget.period}</span>
                      )}
                      <span className="ml-auto tabular-nums text-ink-300">
                        {money(budget.spent)} / {money(budget.cap)}
                      </span>
                      <BudgetRemoveButton
                        projectId={budget.projectId}
                        budgetId={budget.id}
                        label={budget.projectTitle}
                        canWrite={canWrite}
                      />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-stage-800">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          budget.state === 'over'
                            ? 'bg-rose-500'
                            : budget.state === 'warn'
                              ? 'bg-amber-400'
                              : 'bg-accent-500'
                        )}
                        style={{ width: `${Math.min(100, budget.usedPct)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- 分組 ---------------------------------------------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <GroupTable title="依作品" rows={overview.byProject} money={money} />
            <GroupTable title="依月份" rows={overview.byMonth} money={money} />
          </div>

          {/* ---- 明細 ---------------------------------------------------- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-medium text-ink-300">
              最近 {overview.recent.length} 筆
            </h3>
            <ul className="flex flex-col gap-1">
              {overview.recent.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-stage-900 px-3 py-2 text-[11px] ring-1 ring-stage-700/60"
                >
                  {!line.settled && (
                    <span className="rounded bg-stage-800 px-1.5 py-0.5 text-[9px] text-ink-500">
                      估算
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink-200">{line.what}</span>
                  <span className="text-[10px] text-ink-600">{line.projectTitle}</span>
                  <span className="text-[10px] text-ink-700">{formatRelativeZh(line.when)}</span>
                  <span className="tabular-nums text-ink-300">{money(line.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'plain' | 'solid' | 'accent'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-xl p-3 ring-1',
        tone === 'accent'
          ? 'bg-accent-600/15 ring-accent-500/40'
          : 'bg-stage-900 ring-stage-700/60'
      )}
    >
      <span className="text-[10px] text-ink-500">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          tone === 'plain' ? 'text-sm text-ink-100' : 'text-base font-semibold text-ink-50'
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-ink-700">{hint}</span>}
    </div>
  )
}

function GroupTable({
  title,
  rows,
  money,
}: {
  title: string
  rows: CostByGroup[]
  money: (amount: number) => string
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium text-ink-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[11px] text-ink-600">沒有資料。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const total = row.actual + row.committed + row.manual
            return (
              <li
                key={row.key}
                className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-stage-900 px-3 py-2 text-[11px] ring-1 ring-stage-700/60"
              >
                <span className="min-w-0 flex-1 truncate text-ink-200">{row.label}</span>
                {row.committed > 0 && (
                  <span className="text-[10px] text-ink-600">
                    估 {money(row.committed)}
                  </span>
                )}
                <span className="tabular-nums text-ink-100">{money(total)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
