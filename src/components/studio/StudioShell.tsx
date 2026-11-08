'use client'

import {
  Bell,
  BookOpen,
  Bot,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Film,
  Headphones,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  PenLine,
  PlayCircle,
  Receipt,
  Settings,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { CommandPalette } from '@/components/studio/CommandPalette'
import { MilestoneBadge } from '@/components/studio/MilestoneBadge'
import { useToast } from '@/components/ui/Toast'
import type { SessionUser } from '@/lib/auth/session'
import { apiFetch } from '@/lib/client-fetch'
import {
  CURRENCIES,
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
  type CurrencyValue,
} from '@/lib/money'
import {
  activeSectionKey,
  isActiveHref,
  NAV_FOOTER,
  NAV_SECTIONS,
  type NavLeaf,
  type NavSection,
} from '@/lib/navigation'
import { useUiScript } from '@/components/ScriptProvider'
import { cn } from '@/lib/utils'

/**
 * Two-level chrome, matching the reference art in `UI Design/`: a horizontal
 * section bar across the top and the full navigation tree in the left rail.
 *
 * Desktop-first per the spec. Below `lg` the rail becomes a slide-over and the
 * top bar collapses to a menu button, so the tool stays usable on a phone for
 * checking status.
 */

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bot,
  CircleHelp,
  Clapperboard,
  Film,
  PenLine,
  BookOpen,
  Headphones,
  Layers,
  ListChecks,
  MessageSquare,
  PlayCircle,
  Users,
  Receipt,
  Settings,
  Sparkles,
}

export function StudioShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [railOpen, setRailOpen] = useState(false)

  return (
    /*
     * 側邊欄與內容分開捲 (Z133).
     *
     * 回報：「我在內容捲動側邊欄跟著跑」。因為桌機版的 `<aside>` 是
     * `lg:static`，而這一層是 `min-h-dvh`——所以捲的是**整份文件**，側邊欄
     * 當然跟著走。
     *
     * 改成鎖住視窗高度、讓 `<main>` 自己捲，側邊欄就留在原地（它的 `<nav>`
     * 本來就有自己的 `overflow-y-auto`）。
     *
     * **只在 `lg` 以上這樣做。** 手機版的側邊欄是浮在上面的 `fixed` 抽屜，
     * 本來就不會跟著捲；而把整頁改成不可捲會連帶關掉瀏覽器自己收起網址列的
     * 行為，在小螢幕上那等於白白少一截可視高度。
     */
    <div className="flex min-h-dvh bg-stage-950 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <Rail user={user} open={railOpen} onClose={() => setRailOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <TopBar user={user} onOpenRail={() => setRailOpen(true)} />
        <main className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Top bar.
 *
 * Spec v3's designs removed the horizontal section tabs: navigation lives in
 * the rail alone, and this strip carries the current location, global search
 * and the account menu. Two parallel navigations was exactly the duplication
 * the B+ decision set out to remove (`docs/ROUTES.md`).
 */
function TopBar({ user, onOpenRail }: { user: SessionUser; onOpenRail: () => void }) {
  const pathname = usePathname()
  const activeKey = activeSectionKey(pathname)
  const section = NAV_SECTIONS.find((s) => s.key === activeKey)

  return (
    <header
      className="glass sticky z-30 flex h-16 shrink-0 items-center gap-2 border-b border-stage-700/70 px-3 sm:px-4"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <button
        type="button"
        aria-label="開啟選單"
        onClick={onOpenRail}
        className="rounded-lg p-2 text-ink-400 hover:bg-stage-800 hover:text-ink-100 lg:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-50">
        {section?.label ?? 'Drama Studio'}
      </h1>

      <CommandPalette />

      <div className="flex shrink-0 items-center gap-1">
        {/* Disabled rather than dead: spec v2 §4 forbids a button that does nothing. */}
        <ChromeButton
          label="通知"
          disabled
          reason="通知中心尚未實作，預計於 M4 階段交付"
          icon={<Bell aria-hidden className="size-4" />}
        />
        {/* 說明中心做好了，所以這顆不再是停用的 (Z189)。 */}
        <Link
          href="/help"
          aria-label="使用說明"
          title="使用說明"
          className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100"
        >
          <CircleHelp aria-hidden className="size-4" />
        </Link>
        <UserChip user={user} />
      </div>
    </header>
  )
}

function ChromeButton({
  label,
  icon,
  disabled,
  reason,
  onClick,
}: {
  label: string
  icon: ReactNode
  disabled?: boolean
  reason?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={disabled ? reason : label}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'rounded-lg p-2 transition-colors',
        disabled
          ? 'cursor-default text-ink-700 hover:bg-stage-800/60 hover:text-ink-500'
          : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      {icon}
    </button>
  )
}

function UserChip({ user }: { user: SessionUser }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
      // The worker caches only static assets, but a sign-out is the right
      // moment to leave nothing of this session behind on the device.
      navigator.serviceWorker?.controller?.postMessage('srds:clear-cache')
      router.replace('/login')
      router.refresh()
    } catch {
      toast.error('登出失敗', '請重新整理頁面後再試')
      setSigningOut(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 text-left transition-colors hover:bg-stage-800"
      >
        <Avatar user={user} />
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-xs font-medium text-ink-100">{user.name}</span>
          <span className="truncate text-[10px] text-ink-500">{user.title}</span>
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-ink-500" />
      </button>

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="panel absolute right-0 z-20 mt-1 w-52 animate-rise overflow-hidden rounded-xl bg-stage-850 p-1 shadow-2xl shadow-stage-990/80 ring-1 ring-stage-700"
          >
            <div className="border-b border-stage-700/70 px-3 py-2">
              <p className="truncate text-xs font-medium text-ink-100">{user.name}</p>
              <p className="truncate text-[10px] text-ink-500">{user.email}</p>
            </div>

            <CurrencyPicker current={user.displayCurrency} />
            <ScriptPicker />
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={signOut}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-300 transition-colors hover:bg-stage-800 hover:text-ink-50 disabled:opacity-50"
            >
              <LogOut aria-hidden className="size-3.5" />
              {signingOut ? '登出中…' : '登出'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Which currency this member reads totals in.
 *
 * A per-member display preference, not a data change: amounts stay in the
 * currency they were recorded in and are converted on render, so one member
 * reading in USD cannot alter what the other sees.
 */
function CurrencyPicker({ current }: { current: CurrencyValue }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, setPending] = useState<CurrencyValue | null>(null)
  const [value, setValue] = useState(current)

  async function choose(next: CurrencyValue) {
    if (next === value || pending) return

    const previous = value
    setValue(next) // optimistic
    setPending(next)

    try {
      const response = await apiFetch('/api/settings/currency', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currency: next }),
      })
      if (!response.ok) throw new Error(await response.text())

      // Server Components hold the formatted figures; re-render them.
      router.refresh()
    } catch {
      setValue(previous)
      toast.error('幣別切換失敗', '請稍後再試')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="border-b border-stage-700/70 px-3 py-2">
      <p className="mb-1.5 text-[10px] text-ink-600">顯示幣別</p>
      <div className="flex gap-1" role="group" aria-label="顯示幣別">
        {CURRENCIES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => void choose(code)}
            aria-pressed={value === code}
            title={CURRENCY_LABEL[code]}
            disabled={pending !== null}
            className={cn(
              'flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60',
              value === code
                ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
            )}
          >
            {CURRENCY_SYMBOL[code]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Member avatar. A gradient initial stands in until real portraits exist —
 * see the asset list in the README.
 */
/**
 * 繁簡切換 (Z135，整段理由在 Z172／Z174 換掉).
 *
 * 只有兩個狀態，因為介面只有兩種讀法——但**兩邊現在都是一次真的轉換**。
 *
 * 這段註解原本寫「原始字串是繁體，所以繁體就是不轉」，而且說「簡轉繁那個一對
 * 多的方向永遠不會被執行」。兩句話現在都錯了：稿子是簡體寫的，而畫面上絕大多
 * 數的中文（場次內容、分鏡描述、角色小傳、搜尋結果、聊天訊息）都是從資料庫來
 * 的，所以「不轉」給不出繁體。簡 → 繁 會被執行，靠 `chinese.ts` 的防護避免把
 * 寫死的繁體標籤改壞。
 *
 * **切哪一邊都重新載入**（原本只有切回繁體才載入）：轉換是就地改寫文字節點，
 * 原字沒有留著，所以從已經轉過的 DOM 轉回去會走樣。為了支援還原而在記憶體裡
 * 放一份整份文件的影本，是一個附帶功能的記憶體洩漏。點已經選中的那一顆不會重
 * 載。
 */
function ScriptPicker() {
  const { script, setScript } = useUiScript()

  return (
    <div className="px-3 py-2" data-script-keep>
      <p className="mb-1 text-[10px] text-ink-600">介面文字</p>
      <div className="flex gap-1 rounded-lg bg-stage-900 p-0.5 ring-1 ring-stage-700">
        {(
          [
            ['simplified', '简体'],
            ['traditional', '繁體'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={script === value}
            onClick={() => setScript(value)}
            className={cn(
              'flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors',
              script === value
                ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                : 'text-ink-400 hover:text-ink-100'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Avatar({ user }: { user: SessionUser }) {
  const initial = user.name.trim().charAt(0) || '?'
  const isLead = user.title.toUpperCase().includes('CEO')

  return (
    <span className="bg-brand-gradient relative inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-1 ring-accent-500/50">
      {initial}
      {isLead && (
        <span
          aria-hidden
          title="製作總負責人"
          className="absolute -top-1 -right-1 text-[10px] leading-none"
        >
          👑
        </span>
      )}
      <span
        aria-hidden
        className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-stage-900"
      />
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Left rail                                                                   */
/* -------------------------------------------------------------------------- */

function Rail({
  user,
  open,
  onClose,
}: {
  user: SessionUser
  open: boolean
  onClose: () => void
}) {
  const pathname = usePathname()

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-40 animate-fade-in bg-stage-990/80 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-stage-700/70 bg-stage-900',
          'transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Brand onClose={onClose} />

        <nav aria-label="導覽" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ul className="flex flex-col gap-0.5">
            {NAV_SECTIONS.map((section) => (
              <RailSection
                key={section.key}
                section={section}
                pathname={pathname}
                onNavigate={onClose}
              />
            ))}
          </ul>

          <ul className="mt-2 flex flex-col gap-0.5 border-t border-stage-700/50 pt-2">
            {NAV_FOOTER.map((leaf) => (
              <li key={leaf.key}>
                <RailLeaf leaf={leaf} pathname={pathname} onNavigate={onClose} indent={false} />
              </li>
            ))}
          </ul>
        </nav>

        <RailFoot user={user} />
      </aside>
    </>
  )
}

function Brand({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-stage-700/70 px-4">
      {/*
        The supplied master is the full lockup with wordmark; at 32px the type
        would be noise, so `scripts/brand-assets.sh` cuts the snowflake out of
        it and this shows only that glyph. The wordmark sits next to it as live
        text instead, which stays legible and searchable.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mark.webp"
        alt=""
        aria-hidden
        width={32}
        height={32}
        className="glow-accent-sm size-8 shrink-0 rounded-lg"
      />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-brand-gradient truncate text-[13px] font-semibold">
          SnowRealm Drama Studio
        </span>
        <span className="truncate text-[10px] text-ink-600">AI 短劇製作與發行平台</span>
      </div>
      <button
        type="button"
        aria-label="關閉選單"
        onClick={onClose}
        className="ml-auto rounded-lg p-1.5 text-ink-500 hover:bg-stage-800 hover:text-ink-100 lg:hidden"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}

/**
 * One rail row.
 *
 * Flat: the rail holds only cross-project destinations now, so there are no
 * child entries to expand (`docs/ROUTES.md` §2). Anything belonging to a single
 * project lives in the workspace tab strip instead.
 */
function RailSection({
  section,
  pathname,
  onNavigate,
}: {
  section: NavSection
  pathname: string
  onNavigate: () => void
}) {
  const Icon = ICONS[section.icon] ?? LayoutDashboard
  const active = section.ready && isActiveHref(pathname, section.href)

  // py-[13px] keeps the row 10px taller than the default, as requested.
  const row =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[13px] text-xs font-medium transition-all'

  const label = (
    <>
      <Icon
        aria-hidden
        className={cn(
          'size-4 shrink-0',
          active ? 'text-white' : section.ready ? 'text-ink-500' : 'text-ink-700'
        )}
      />
      <span className="truncate">{section.label}</span>
    </>
  )

  return (
    <li>
      <div className="flex items-center gap-1">
        {section.ready ? (
          <Link
            href={section.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              row,
              active
                ? 'bg-brand-gradient glow-accent-sm text-white'
                : 'text-ink-300 hover:bg-stage-800 hover:text-ink-50'
            )}
          >
            {label}
          </Link>
        ) : (
          <span
            aria-disabled="true"
            title={`「${section.label}」尚未實作，預計於 ${section.milestone} 階段交付`}
            className={cn(row, 'cursor-default text-ink-600 select-none hover:bg-stage-800/60 hover:text-ink-400')}
          >
            {label}
            {section.milestone && (
              <MilestoneBadge
                milestone={section.milestone}
                label={section.label}
                className="ml-auto"
              />
            )}
          </span>
        )}

      </div>
    </li>
  )
}

function RailLeaf({
  leaf,
  pathname,
  onNavigate,
  indent,
}: {
  leaf: NavLeaf
  pathname: string
  onNavigate: () => void
  indent: boolean
}) {
  const active = leaf.ready && isActiveHref(pathname, leaf.href)

  const row = cn(
    'flex items-center gap-2 rounded-lg py-2 pr-2.5 text-xs transition-all',
    indent ? 'pl-9' : 'pl-2.5'
  )

  if (!leaf.ready) {
    return (
      <span
        aria-disabled="true"
        title={`「${leaf.label}」尚未實作，預計於 ${leaf.milestone} 階段交付`}
        className={cn(row, 'cursor-default text-ink-700 select-none hover:bg-stage-800/60 hover:text-ink-500')}
      >
        <span className="truncate">{leaf.label}</span>
        {leaf.milestone && (
          <MilestoneBadge milestone={leaf.milestone} label={leaf.label} className="ml-auto" />
        )}
      </span>
    )
  }

  return (
    <Link
      href={leaf.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        row,
        active
          ? 'bg-accent-600/20 text-ink-50 ring-1 ring-inset ring-accent-500/40'
          : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
      )}
    >
      <span className="truncate">{leaf.label}</span>
    </Link>
  )
}

/**
 * Foot of the rail.
 *
 * The brief (`docs/NEEDED_FROM_YOU.md` C2) asked for a dark illustration that
 * fades out at the top and sides. The supplied master is a brightly lit studio
 * with hard edges, so the fade and the dimming are done here with
 * `.scrim-rail-foot` — the artwork is decoration behind the user's own name,
 * and the name has to stay readable.
 */
function RailFoot({ user }: { user: SessionUser }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden border-t border-stage-700/50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/rail-foot.webp"
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover opacity-55"
      />
      <div aria-hidden className="scrim-rail-foot absolute inset-0" />
      <div className="relative flex items-center gap-2.5 px-4 py-3">
        <Avatar user={user} />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs font-medium text-ink-100">{user.name}</span>
          <span className="truncate text-[10px] text-ink-500">{user.title}</span>
        </div>
      </div>
    </div>
  )
}
