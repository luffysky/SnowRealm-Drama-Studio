'use client'

import {
  Bell,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Film,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  PenLine,
  Receipt,
  Settings,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useToast } from '@/components/ui/Toast'
import type { SessionUser } from '@/lib/auth/session'
import { apiFetch } from '@/lib/client-fetch'
import {
  activeProjectId,
  activeSectionKey,
  isActiveHref,
  NAV_FOOTER,
  NAV_SECTIONS,
  resolveLeaf,
  type NavLeaf,
  type NavSection,
} from '@/lib/navigation'
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
  Clapperboard,
  Film,
  PenLine,
  BookOpen,
  Layers,
  Users,
  Receipt,
  Settings,
}

export function StudioShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [railOpen, setRailOpen] = useState(false)

  return (
    <div className="flex min-h-dvh bg-stage-950">
      <Rail user={user} open={railOpen} onClose={() => setRailOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} onOpenRail={() => setRailOpen(true)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                     */
/* -------------------------------------------------------------------------- */

function TopBar({ user, onOpenRail }: { user: SessionUser; onOpenRail: () => void }) {
  const pathname = usePathname()
  const activeKey = activeSectionKey(pathname)

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

      <nav aria-label="主要區域" className="hidden min-w-0 flex-1 lg:block">
        <ul className="flex items-center gap-1 overflow-x-auto">
          {NAV_SECTIONS.map((section) => (
            <li key={section.key}>
              <SectionTab section={section} active={section.key === activeKey} />
            </li>
          ))}
        </ul>
      </nav>

      <span className="flex-1 text-sm font-semibold text-ink-50 lg:hidden">Drama Studio</span>

      <div className="flex shrink-0 items-center gap-1">
        {/* Disabled rather than dead: spec v2 §4 forbids a button that does nothing. */}
        <ChromeButton
          label="通知"
          disabled
          reason="通知中心尚未實作，預計於 M4 階段交付"
          icon={<Bell aria-hidden className="size-4" />}
        />
        <ChromeButton
          label="說明"
          disabled
          reason="說明中心尚未實作"
          icon={<CircleHelp aria-hidden className="size-4" />}
        />
        <UserChip user={user} />
      </div>
    </header>
  )
}

function SectionTab({ section, active }: { section: NavSection; active: boolean }) {
  const Icon = ICONS[section.icon] ?? LayoutDashboard

  const base =
    'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-all'

  if (!section.ready) {
    return (
      <span
        aria-disabled="true"
        title={`「${section.label}」尚未實作，預計於 ${section.milestone} 階段交付`}
        className={cn(base, 'cursor-default text-ink-600 hover:bg-stage-800/60 hover:text-ink-400')}
      >
        <Icon aria-hidden className="size-4 opacity-60" />
        {section.label}
      </span>
    )
  }

  return (
    <Link
      href={section.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        active
          ? 'bg-brand-gradient glow-accent-sm text-white'
          : 'text-ink-300 hover:bg-stage-800 hover:text-ink-50'
      )}
    >
      <Icon aria-hidden className="size-4" />
      {section.label}
    </Link>
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
 * Member avatar. A gradient initial stands in until real portraits exist —
 * see the asset list in the README.
 */
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
  const activeKey = activeSectionKey(pathname)
  // Project-scoped entries resolve their `_` placeholder against this.
  const projectId = activeProjectId(pathname)

  // A section with children starts expanded when it contains the current page.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV_SECTIONS.map((s) => [s.key, s.key === activeKey]))
  )

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
                projectId={projectId}
                expanded={expanded[section.key] ?? false}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [section.key]: !prev[section.key] }))
                }
                onNavigate={onClose}
              />
            ))}
          </ul>

          <ul className="mt-2 flex flex-col gap-0.5 border-t border-stage-700/50 pt-2">
            {NAV_FOOTER.map((leaf) => (
              <li key={leaf.key}>
                <RailLeaf
                  leaf={leaf}
                  pathname={pathname}
                  projectId={projectId}
                  onNavigate={onClose}
                  indent={false}
                />
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
      {/* Placeholder mark until the snowflake logo asset is supplied. */}
      <span
        aria-hidden
        className="bg-brand-gradient glow-accent-sm flex size-8 shrink-0 items-center justify-center rounded-lg text-sm"
      >
        ❄
      </span>
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

function RailSection({
  section,
  pathname,
  projectId,
  expanded,
  onToggle,
  onNavigate,
}: {
  section: NavSection
  pathname: string
  projectId: string | null
  expanded: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const Icon = ICONS[section.icon] ?? LayoutDashboard
  const hasChildren = Boolean(section.children?.length)
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
            <span className="ml-auto shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[10px] font-normal text-ink-600 ring-1 ring-inset ring-stage-700">
              {section.milestone}
            </span>
          </span>
        )}

        {hasChildren && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? '收合' : '展開'}${section.label}`}
            className="shrink-0 rounded p-1 text-ink-600 transition-colors hover:bg-stage-800 hover:text-ink-300"
          >
            <ChevronDown
              aria-hidden
              className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
            />
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {(section.children ?? []).map((leaf) => (
            <li key={leaf.key}>
              <RailLeaf
                leaf={leaf}
                pathname={pathname}
                projectId={projectId}
                onNavigate={onNavigate}
                indent
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function RailLeaf({
  leaf,
  pathname,
  projectId,
  onNavigate,
  indent,
}: {
  leaf: NavLeaf
  pathname: string
  projectId: string | null
  onNavigate: () => void
  indent: boolean
}) {
  const { href, enabled, reason } = resolveLeaf(leaf, projectId)
  const active = enabled && isActiveHref(pathname, href)

  const row = cn(
    'flex items-center gap-2 rounded-lg py-2 pr-2.5 text-xs transition-all',
    indent ? 'pl-9' : 'pl-2.5'
  )

  if (!enabled) {
    return (
      <span
        aria-disabled="true"
        title={reason}
        className={cn(row, 'cursor-default text-ink-700 select-none hover:bg-stage-800/60 hover:text-ink-500')}
      >
        <span className="truncate">{leaf.label}</span>
        {/* A ready-but-unscoped entry shows no milestone — it is built. */}
        <span className="ml-auto shrink-0 text-[10px] text-ink-700">
          {leaf.ready ? '需選作品' : leaf.milestone}
        </span>
      </span>
    )
  }

  return (
    <Link
      href={href}
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
 * Foot of the rail. The reference art has a lantern illustration here; until
 * that asset exists this is a gradient wash, which reads as deliberate rather
 * than as a missing image.
 */
function RailFoot({ user }: { user: SessionUser }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden border-t border-stage-700/50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div aria-hidden className="art-placeholder absolute inset-0 opacity-40" />
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
