import { Users } from 'lucide-react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { teamOverview } from '@/lib/team'
import { cn, formatRelativeZh } from '@/lib/utils'

export const metadata: Metadata = { title: '團隊管理' }

/**
 * 團隊管理 (Z44).
 *
 * 側邊欄上掛著這一項、標著 M4，畫面從來沒有做出來。
 *
 * ## 這一頁誠實的樣子
 *
 * 兩個人都是擁有者，所以**每一條權限現在都是通的**——`rbac.ts` 的註解自己
 * 就這樣寫。畫一張看起來在管控什麼的表會是假的，所以下面那張表直說：哪幾
 * 條是擁有者專屬的，以及現在沒有人受它限制。
 *
 * 改角色也沒有做：`profileUpdateSchema` 裡沒有 `role`，所以任何 API 都改不
 * 了它。與其放一個會失敗的下拉，不如把理由寫出來。
 */
export default async function TeamPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const overview = await teamOverview()
  const everyoneIsOwner = overview.members.every((member) => member.role === 'OWNER')

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Users aria-hidden className="size-4 text-accent-400" />
          團隊管理
        </h2>
        <p className="text-[11px] text-ink-500">
          誰在這個工作室、做過什麼、能做什麼。
        </p>
      </header>

      {/* ---- 成員 ------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium text-ink-300">成員 {overview.members.length}</h3>

        <ul className="grid gap-2 sm:grid-cols-2">
          {overview.members.map((member) => (
            <li
              key={member.id}
              className="flex flex-col gap-1.5 rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700/60"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-medium text-white"
                  style={{ backgroundColor: member.color || '#7c5cff' }}
                >
                  {member.name.trim().charAt(0) || '?'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] text-ink-50">{member.name}</span>
                  <span className="truncate text-[10px] text-ink-600">
                    {member.title || '（沒有職稱）'}
                  </span>
                </div>
                <span className="shrink-0 rounded bg-accent-600/20 px-1.5 py-0.5 text-[9px] text-accent-200">
                  {member.roleLabel}
                </span>
              </div>

              <p className="flex flex-wrap gap-x-3 text-[10px] text-ink-600">
                <span className="font-mono">{member.email}</span>
                {member.account && <span className="font-mono">@{member.account}</span>}
              </p>

              <p className="flex flex-wrap gap-x-3 text-[10px] text-ink-500">
                <span className="tabular-nums">{member.actions} 筆動態</span>
                <span>
                  最後活動{' '}
                  {member.lastActiveAt ? formatRelativeZh(member.lastActiveAt) : '沒有紀錄'}
                </span>
              </p>

              {/*
               * 舊顯示名不是髒資料，是紀錄。
               *
               * `activities.user_name` 刻意反正規化，所以當時叫什麼就顯示什麼
               * ——「煙火」就是暖寶以前的名字。按 user_id 歸戶之後，這裡把它
               * 當附註列出來，而不是讓同一個人在列表裡裂成兩個。
               */}
              {member.formerNames.length > 0 && (
                <p className="text-[10px] text-ink-700">
                  以前記成
                  {member.formerNames.map((former) => (
                    <span key={former.name} className="ml-1.5">
                      「{former.name}」{former.count} 筆
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>

        <p className="text-[10px] leading-relaxed text-ink-700">
          名字、Email、帳號、職稱、顏色到「個人設定」改。
          <span className="text-amber-400/70">
            　角色（擁有者／協作者）目前沒有地方可以改——改角色的 API 還沒有做，
            與其放一個按了會失敗的選單，不如先說清楚。
          </span>
        </p>
      </section>

      {/* ---- 權限 ------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium text-ink-300">權限</h3>

        {everyoneIsOwner && (
          <p className="rounded-lg bg-stage-900 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500 ring-1 ring-stage-700/60">
            目前兩個人都是擁有者，所以下面每一條現在都是通的。這張表是在說
            「如果之後加一個協作者帳號，他會少掉哪幾件事」。
          </p>
        )}

        <ul className="flex flex-wrap gap-1">
          {overview.permissions.map((row) => (
            <li
              key={row.permission}
              className={cn(
                'rounded-lg px-2 py-1 font-mono text-[10px] ring-1',
                row.ownerOnly
                  ? 'bg-amber-500/10 text-amber-300/90 ring-amber-500/30'
                  : 'bg-stage-900 text-ink-500 ring-stage-700/60'
              )}
              title={row.ownerOnly ? '只有擁有者可以' : '兩種角色都可以'}
            >
              {row.permission}
              {row.ownerOnly && <span className="ml-1 text-[9px]">擁有者</span>}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- 動態 ------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium text-ink-300">最近動態</h3>

        {overview.recent.length === 0 ? (
          <p className="text-[11px] text-ink-600">還沒有任何紀錄。</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {overview.recent.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-stage-900 px-3 py-2 text-[11px] ring-1 ring-stage-700/60"
              >
                <span className="shrink-0 text-ink-300">{row.recordedAs || '系統'}</span>
                <span className="min-w-0 flex-1 truncate text-ink-500">
                  {row.summary || `${row.action} ${row.entityType}`}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-ink-700">{row.action}</span>
                <span className="shrink-0 text-[10px] text-ink-700">
                  {formatRelativeZh(row.at)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {overview.unattributed > 0 && (
          <p className="text-[10px] text-ink-700">
            另有 {overview.unattributed} 筆沒有對應到成員——通常是系統自己做的事，
            或是帳號已經不在了。
          </p>
        )}
      </section>
    </div>
  )
}
