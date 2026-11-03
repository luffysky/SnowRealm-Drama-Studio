'use client'

import { Check, ChevronDown, ChevronRight, Film } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { AltTitles } from '@/components/studio/AltTitles'
import { MilestoneBadge } from '@/components/studio/MilestoneBadge'
import {
  ProjectSettingsDialog,
  type ProjectSettings,
} from '@/components/studio/ProjectSettingsDialog'
import {
  activeProjectTabKey,
  PROJECT_TABS,
  projectTabHref,
  type ProjectTab,
} from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { assetPreviewUrl } from '@/lib/asset-url'

/**
 * The project workspace header: breadcrumb, title, project switcher and the
 * tab strip (`docs/ROUTES.md` §3).
 *
 * A Client Component only because the active tab and the switcher need the
 * current pathname and a little local state. Everything it renders is handed
 * to it by the layout, which did the permission check on the server.
 *
 * Switching project is a link to the *same tab* under another projectId —
 * never a mutation of some global "current project", which §4 forbids.
 */

export type WorkspaceProject = {
  id: string
  title: string
  /** Empty = same as `title`; resolved through `@/lib/project-titles`. */
  novelTitle?: string
  dramaTitle?: string
  isFlagship: boolean
  coverAssetId: string | null
  /** Shown in the switcher under each title, e.g.「製作中 · 120 集」. */
  summary?: string
}

export function ProjectWorkspaceChrome({
  project,
  siblings,
  statusLabel,
  statusClassName,
  tags,
  logline,
  settings,
  canWrite,
}: {
  project: WorkspaceProject
  /** Every project this member may open, for the switcher. */
  siblings: WorkspaceProject[]
  statusLabel: string
  statusClassName: string
  tags: string[]
  logline: string
  /**
   * Everything 作品設定 edits. Separate from `project`, which is the
   * switcher's shape and deliberately small — the switcher lists every work
   * the member can open, and does not need their synopses.
   */
  settings: ProjectSettings
  /** Whether this member may open 作品設定. */
  canWrite: boolean
}) {
  const pathname = usePathname()
  const activeKey = activeProjectTabKey(pathname, project.id) ?? 'overview'

  return (
    <header className="flex flex-col gap-3 border-b border-stage-700/60 bg-stage-900/60 px-3 pt-3 sm:px-4 lg:px-6">
      <nav aria-label="麵包屑" className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <Link href="/projects" className="transition-colors hover:text-ink-200">
          作品列表
        </Link>
        <ChevronRight aria-hidden className="size-3" />
        <span className="truncate text-ink-200">{project.title}</span>
      </nav>

      <div className="flex items-start gap-3 sm:gap-4">
        {/*
          Private bucket: the cover is fetched through /api/files, which checks
          the session and then redirects to a short-lived presigned URL.
        */}
        {project.coverAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetPreviewUrl(project.coverAssetId)}
            alt=""
            decoding="async"
            className="hidden h-20 w-32 shrink-0 rounded-lg object-cover ring-1 ring-stage-700 sm:block lg:h-24 lg:w-40"
          />
        ) : (
          <div
            aria-hidden
            className="art-placeholder hidden h-20 w-32 shrink-0 rounded-lg ring-1 ring-stage-700 sm:block lg:h-24 lg:w-40"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectSwitcher project={project} siblings={siblings} activeKey={activeKey} />

            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
                statusClassName
              )}
            >
              {statusLabel}
            </span>

            {tags.length > 0 && (
              <span className="truncate text-[11px] text-ink-500">{tags.join(' × ')}</span>
            )}

            <span className="ml-auto shrink-0">
              <ProjectSettingsDialog project={settings} canWrite={canWrite} />
            </span>
          </div>

          <AltTitles
            project={{
              title: project.title,
              novelTitle: project.novelTitle ?? '',
              dramaTitle: project.dramaTitle ?? '',
            }}
          />

          <p className="line-clamp-2 max-w-3xl text-xs leading-relaxed text-ink-400">
            {logline || (
              <span className="text-ink-600">
                尚未撰寫一句話簡介——待故事定稿後於「作品設定」填入。
              </span>
            )}
          </p>
        </div>
      </div>

      <TabStrip projectId={project.id} activeKey={activeKey} />
    </header>
  )
}

function ProjectSwitcher({
  project,
  siblings,
  activeKey,
}: {
  project: WorkspaceProject
  siblings: WorkspaceProject[]
  activeKey: string
}) {
  const [open, setOpen] = useState(false)

  // Staying on the same tab when switching is the point: comparing two
  // projects' 分鏡 should not bounce back to the overview each time.
  const tab = PROJECT_TABS.find((t) => t.key === activeKey) ?? PROJECT_TABS[0]!
  const others = siblings.filter((s) => s.id !== project.id)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={others.length === 0}
        title={others.length === 0 ? '目前只有一部作品' : '切換作品'}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 text-left transition-colors',
          others.length > 0 ? 'hover:bg-stage-800' : 'cursor-default'
        )}
      >
        <h1 className="truncate text-lg font-semibold tracking-tight text-ink-50 sm:text-xl">
          {project.title}
        </h1>
        {others.length > 0 && (
          <ChevronDown
            aria-hidden
            className={cn('size-4 shrink-0 text-ink-500 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {open && others.length > 0 && (
        <>
          <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="panel absolute left-0 z-20 mt-1 w-60 animate-rise overflow-hidden rounded-xl bg-stage-850 p-1 shadow-2xl shadow-stage-990/80 ring-1 ring-stage-700"
          >
            <p className="px-3 py-1.5 text-[10px] text-ink-600">切換作品（停留在同一分頁）</p>
            {siblings.map((sibling) => {
              const current = sibling.id === project.id
              return (
                <Link
                  key={sibling.id}
                  role="menuitem"
                  href={projectTabHref(sibling.id, tab)}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
                    current
                      ? 'bg-accent-600/20 text-ink-50'
                      : 'text-ink-300 hover:bg-stage-800 hover:text-ink-50'
                  )}
                >
                  {sibling.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPreviewUrl(sibling.coverAssetId)}
                      alt=""
                      decoding="async"
                      className="h-6 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <Film aria-hidden className="size-3.5 shrink-0 text-ink-500" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate">{sibling.title}</span>
                    {sibling.summary && (
                      <span className="truncate text-[10px] text-ink-600">{sibling.summary}</span>
                    )}
                  </span>
                  {current && <Check aria-hidden className="size-3.5 shrink-0 text-accent-400" />}
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function TabStrip({ projectId, activeKey }: { projectId: string; activeKey: string }) {
  return (
    <nav aria-label="作品分頁" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max items-center gap-1">
        {PROJECT_TABS.map((tab) => (
          <li key={tab.key}>
            <Tab tab={tab} projectId={projectId} active={tab.key === activeKey} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Tab({
  tab,
  projectId,
  active,
}: {
  tab: ProjectTab
  projectId: string
  active: boolean
}) {
  const base =
    'inline-flex items-center gap-1 rounded-t-lg border-b-2 px-3 py-2 text-xs whitespace-nowrap transition-all'

  if (!tab.ready) {
    return (
      <span
        aria-disabled="true"
        title={`「${tab.label}」尚未實作，預計於 ${tab.milestone} 階段交付`}
        className={cn(
          base,
          'cursor-default border-transparent text-ink-600 select-none hover:text-ink-400'
        )}
      >
        {tab.label}
        {tab.milestone && <MilestoneBadge milestone={tab.milestone} label={tab.label} />}
      </span>
    )
  }

  return (
    <Link
      href={projectTabHref(projectId, tab)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        active
          ? 'border-accent-500 font-medium text-ink-50'
          : 'border-transparent text-ink-400 hover:border-stage-600 hover:text-ink-100'
      )}
    >
      {tab.label}
    </Link>
  )
}
