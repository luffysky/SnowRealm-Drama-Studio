'use client'

import { Check, KeyRound, Loader2, LogOut, Monitor, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { CURRENCIES, CURRENCY_LABEL, type CurrencyValue } from '@/lib/money'
import { cn, formatRelativeZh } from '@/lib/utils'

/**
 * 個人設定 (Z85) and 團隊 (Z86), on one page.
 *
 * Two people, so separating "my account" from "the team" would be two screens
 * showing one row each. What differs is permission, not layout: you may always
 * edit yourself, and only the owner may edit the other member — which exists
 * so a typo'd email does not lock someone out with nobody able to fix it.
 *
 * The password is a separate form on purpose. Changing it revokes every other
 * session, and that is not something to fold into a save button that also
 * changes a display colour.
 */

export type Member = {
  id: string
  name: string
  email: string
  account: string
  title: string
  color: string
  displayCurrency: CurrencyValue
  role: string
}

export type DeviceSession = {
  id: string
  userAgent: string
  ipAddress: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  revokedAt: string | null
  current?: boolean
}

export function ProfileSettings({
  meId,
  members,
  sessions,
  canManageOthers,
}: {
  meId: string
  members: Member[]
  sessions: DeviceSession[]
  canManageOthers: boolean
}) {
  const me = members.find((member) => member.id === meId)
  const others = members.filter((member) => member.id !== meId)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <UserRound aria-hidden className="size-4 text-accent-400" />
          個人設定
        </h2>
        <p className="text-[11px] text-ink-500">名字、Email、帳號、密碼與登入裝置。</p>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {me && <MemberForm member={me} isSelf />}
          <PasswordForm />
        </div>

        <div className="flex flex-col gap-4">
          <Devices sessions={sessions} />

          {others.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-ink-300">其他成員</h3>
              {others.map((member) => (
                <MemberForm key={member.id} member={member} isSelf={false} locked={!canManageOthers} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function MemberForm({
  member,
  isSelf,
  locked,
}: {
  member: Member
  isSelf: boolean
  locked?: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [account, setAccount] = useState(member.account)
  const [title, setTitle] = useState(member.title)
  const [color, setColor] = useState(member.color)
  const [currency, setCurrency] = useState<CurrencyValue>(member.displayCurrency)
  const [saving, setSaving] = useState(false)

  const dirty =
    name !== member.name ||
    email !== member.email ||
    account !== member.account ||
    title !== member.title ||
    color !== member.color ||
    currency !== member.displayCurrency

  async function save() {
    setSaving(true)
    try {
      const response = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(isSelf ? {} : { userId: member.id }),
          name: name.trim(),
          email: email.trim(),
          account: account.trim(),
          title: title.trim(),
          color,
          displayCurrency: currency,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已儲存')
      // The rail, the avatars and the activity feed all render this on the
      // server.
      router.refresh()
    } catch (cause) {
      toast.error('儲存失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <header className="flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ background: color }}
        >
          {name.charAt(0) || '?'}
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs font-medium text-ink-100">
            {isSelf ? '我的資料' : member.name}
          </span>
          <span className="text-[10px] text-ink-500">
            {member.role === 'OWNER' ? '擁有者' : '協作者'}
            {locked && '・唯讀'}
          </span>
        </div>
      </header>

      {locked ? (
        <p className="text-[11px] leading-relaxed text-ink-500">
          只有擁有者能改其他成員的資料。
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名字">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="職稱">
              <Input
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="CEO / 技術總監"
              />
            </Field>
          </div>

          <Field label="Email" description="登入用，也是找回帳號的依據。">
            <Input
              type="email"
              value={email}
              maxLength={160}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="帳號" description="登入時可以用這個代替 Email。留空＝只用 Email 登入。">
            <Input
              value={account}
              maxLength={40}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Luffysky"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="代表色" description="頭像與訊息氣泡會用。">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="代表色"
                  className="h-9 w-12 cursor-pointer rounded-lg bg-stage-900 ring-1 ring-stage-700"
                />
                <Input value={color} maxLength={7} onChange={(e) => setColor(e.target.value)} />
              </div>
            </Field>

            <Field label="金額顯示幣別" description="只影響顯示，不換算儲存值。">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyValue)}
                className="h-9 w-full rounded-lg bg-stage-900 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 outline-none focus:ring-2 focus:ring-accent-500"
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code} className="bg-stage-850">
                    {CURRENCY_LABEL[code]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save()}
              loading={saving}
              loadingText="儲存中…"
              disabled={!dirty}
              leadingIcon={<Check aria-hidden className="size-3.5" />}
            >
              儲存
            </Button>
            {!dirty && <span className="text-[10px] text-ink-600">沒有變更</span>}
          </div>
        </>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function PasswordForm() {
  const toast = useToast()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)

  const mismatch = again.length > 0 && next !== again

  async function submit() {
    if (next !== again) {
      toast.error('兩次輸入的新密碼不一樣')
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      setCurrent('')
      setNext('')
      setAgain('')
      toast.success('密碼已更新', '其他裝置上的登入都已登出')
    } catch (cause) {
      toast.error('密碼未更新', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel flex flex-col gap-3 rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
      <header className="flex items-center gap-2">
        <KeyRound aria-hidden className="size-4 text-accent-400" />
        <h3 className="text-xs font-medium text-ink-200">變更密碼</h3>
      </header>

      <Field label="目前的密碼">
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="新密碼" description="至少 8 個字。">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="再輸入一次">
          <Input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            className={cn(mismatch && 'ring-rose-500')}
          />
        </Field>
      </div>

      {mismatch && <p className="text-[11px] text-rose-400">兩次輸入不一樣</p>}

      <p className="text-[10px] leading-relaxed text-ink-600">
        改完之後，其他裝置上的登入會全部登出——這台不會。
        密碼換了而舊的 cookie 還能用，等於沒換。
      </p>

      <Button
        size="sm"
        variant="primary"
        onClick={() => void submit()}
        loading={saving}
        loadingText="更新中…"
        disabled={!current || next.length < 8 || mismatch}
      >
        更新密碼
      </Button>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function Devices({ sessions }: { sessions: DeviceSession[] }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const live = sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date())

  async function revoke(id: string) {
    setBusy(id)
    try {
      const response = await apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success('已登出那台裝置')
      router.refresh()
    } catch (cause) {
      toast.error('登出失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
      <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
        <Monitor aria-hidden className="size-3.5 text-accent-400" />
        <h3 className="text-xs font-medium text-ink-200">登入裝置</h3>
        <span className="ml-auto text-[10px] text-ink-600">{live.length} 台</span>
      </header>

      {live.length === 0 ? (
        <p className="px-4 py-6 text-center text-[11px] text-ink-600">沒有其他登入中的裝置</p>
      ) : (
        <ul className="flex flex-col divide-y divide-stage-700/40">
          {live.map((session) => (
            <li key={session.id} className="flex items-center gap-2.5 px-4 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[11px] text-ink-200">
                  {describeAgent(session.userAgent)}
                  {session.current && (
                    <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] text-emerald-300">
                      這台
                    </span>
                  )}
                </span>
                <span className="truncate text-[10px] text-ink-600">
                  {session.ipAddress || '未知位址'}・
                  {formatRelativeZh(new Date(session.lastSeenAt))}活動
                </span>
              </span>

              {!session.current && (
                <button
                  type="button"
                  onClick={() => void revoke(session.id)}
                  disabled={busy === session.id}
                  className="tap shrink-0 rounded-md px-2 py-1 text-[10px] text-ink-500 transition-colors hover:bg-stage-800 hover:text-rose-300 disabled:opacity-50"
                >
                  {busy === session.id ? (
                    <Loader2 aria-hidden className="size-3 animate-spin" />
                  ) : (
                    <LogOut aria-hidden className="size-3" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A readable device name from the user agent.
 *
 * Deliberately rough. The string is attacker-controlled and only has to be
 * recognisable enough for someone to tell their own laptop from a session they
 * do not recognise — which is the only decision this list supports.
 */
function describeAgent(agent: string): string {
  if (!agent) return '未知裝置'

  const os = /Windows/i.test(agent)
    ? 'Windows'
    : /iPhone|iPad/i.test(agent)
      ? 'iOS'
      : /Android/i.test(agent)
        ? 'Android'
        : /Mac OS X/i.test(agent)
          ? 'macOS'
          : /Linux/i.test(agent)
            ? 'Linux'
            : ''

  const browser = /Edg\//i.test(agent)
    ? 'Edge'
    : /Chrome\//i.test(agent)
      ? 'Chrome'
      : /Safari\//i.test(agent)
        ? 'Safari'
        : /Firefox\//i.test(agent)
          ? 'Firefox'
          : ''

  return [os, browser].filter(Boolean).join(' · ') || agent.slice(0, 40)
}
