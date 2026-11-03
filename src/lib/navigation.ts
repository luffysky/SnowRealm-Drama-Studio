/**
 * Navigation, in two layers that never overlap (`docs/ROUTES.md`).
 *
 * 1. **The global rail** holds only what is not about one particular project:
 *    the dashboard, the project list, cross-project tasks, costs, the team and
 *    system settings.
 * 2. **The project workspace tabs** hold everything that needs a projectId, and
 *    live under `/projects/[projectId]`.
 *
 * The rail used to carry project-scoped entries — 小說編輯器, 分鏡工作台,
 * 素材管理 — which could not work: clicking one from the dashboard gave the app
 * no project to act on. That is the whole reason the split exists.
 *
 * `ready` gates whether an entry is a link at all. Spec v2 §4 is explicit —
 * 「圖中按鈕必須真能操作；尚未串接的功能應禁用並顯示原因，不做空按鈕」— so an
 * unbuilt entry renders disabled with its milestone, never as a link to a 404.
 */

export type Milestone = 'M1' | 'M2' | 'M3' | 'M4'

export type NavLeaf = {
  key: string
  label: string
  href: string
  ready: boolean
  milestone?: Milestone
  /** Spec v2 page number, for traceability back to the design. */
  design?: number
}

export type NavSection = {
  key: string
  label: string
  /** lucide-react icon name, resolved by the shell. */
  icon: string
  href: string
  ready: boolean
  milestone?: Milestone
  design?: number
}

/**
 * The global rail. Cross-project only.
 *
 * Nothing requiring a projectId may be added here — it belongs in
 * `PROJECT_TABS` instead.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'dashboard',
    label: '工作室儀表板',
    icon: 'LayoutDashboard',
    href: '/dashboard',
    ready: true,
    design: 1,
  },
  {
    key: 'projects',
    label: '作品列表',
    icon: 'Film',
    href: '/projects',
    ready: true,
    design: 3,
  },
  {
    key: 'tasks',
    label: '跨作品任務',
    icon: 'ListChecks',
    href: '/tasks',
    ready: false,
    milestone: 'M4',
    design: 18,
  },
  {
    key: 'costs',
    label: '成本中心',
    icon: 'Receipt',
    href: '/costs',
    ready: false,
    milestone: 'M4',
    design: 23,
  },
  {
    key: 'team',
    label: '團隊管理',
    icon: 'Users',
    href: '/team',
    ready: false,
    milestone: 'M4',
    design: 20,
  },
  {
    key: 'settings',
    label: '系統設定',
    icon: 'Settings',
    href: '/settings',
    ready: false,
    milestone: 'M4',
    design: 21,
  },
]

/** Rail-only entries, pinned to the foot of the tree. */
export const NAV_FOOTER: NavLeaf[] = [
  { key: 'profile', label: '個人設定', href: '/settings/profile', ready: false, milestone: 'M4', design: 22 },
]

/* -------------------------------------------------------------------------- */
/* Project workspace                                                           */
/* -------------------------------------------------------------------------- */

export type ProjectTab = {
  key: string
  label: string
  /** Appended to `/projects/<id>`; empty string is the overview itself. */
  segment: string
  ready: boolean
  milestone?: Milestone
  design?: number
}

/**
 * Every view of one project, in the order the tab strip shows them.
 *
 * One definition drives the strip, the active-tab highlight and the route
 * table in the docs, so a tab cannot exist in the UI without a route or the
 * other way round.
 */
export const PROJECT_TABS: ProjectTab[] = [
  { key: 'overview', label: '總覽', segment: '', ready: true, design: 4 },
  { key: 'episodes', label: '集數', segment: 'episodes', ready: false, milestone: 'M1', design: 5 },
  { key: 'script', label: '劇本', segment: 'script', ready: false, milestone: 'M2', design: 7 },
  { key: 'world', label: '世界觀', segment: 'world', ready: false, milestone: 'M2', design: 9 },
  {
    key: 'characters',
    label: '角色',
    segment: 'characters',
    ready: false,
    milestone: 'M2',
    design: 10,
  },
  {
    key: 'storyboard',
    label: '分鏡',
    segment: 'storyboard',
    ready: false,
    milestone: 'M3',
    design: 12,
  },
  { key: 'assets', label: '素材', segment: 'assets', ready: false, milestone: 'M3', design: 14 },
  {
    key: 'production',
    label: '製作',
    segment: 'production',
    ready: false,
    milestone: 'M3',
    design: 17,
  },
  { key: 'reviews', label: '審核', segment: 'reviews', ready: false, milestone: 'M4', design: 57 },
  { key: 'versions', label: '版本', segment: 'versions', ready: false, milestone: 'M2', design: 8 },
  {
    key: 'settings',
    label: '設定',
    segment: 'settings',
    ready: false,
    milestone: 'M4',
    design: 21,
  },
]

export function projectTabHref(projectId: string, tab: ProjectTab): string {
  return tab.segment ? `/projects/${projectId}/${tab.segment}` : `/projects/${projectId}`
}

/**
 * Which tab the current pathname is in.
 *
 * Read from the URL, never from stored state: `docs/ROUTES.md` §4 requires a
 * deep link, a refresh and two tabs on different projects to all work.
 */
export function activeProjectTabKey(pathname: string, projectId: string): string | null {
  const base = `/projects/${projectId}`
  if (!pathname.startsWith(base)) return null

  const rest = pathname.slice(base.length).replace(/^\//, '')
  if (rest === '') return 'overview'

  const segment = rest.split('/')[0]
  return PROJECT_TABS.find((tab) => tab.segment && tab.segment === segment)?.key ?? null
}

/* -------------------------------------------------------------------------- */

/** The rail section a pathname belongs to, for highlighting. */
export function activeSectionKey(pathname: string): string | null {
  // Longest match wins, so `/settings/profile` does not highlight `/settings`
  // when a more specific section exists.
  let best: NavSection | null = null

  for (const section of NAV_SECTIONS) {
    if (pathname === section.href || pathname.startsWith(`${section.href}/`)) {
      if (!best || section.href.length > best.href.length) best = section
    }
  }

  return best?.key ?? null
}

export function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** How many entries are still unbuilt, shown in the shell's build-status note. */
export function unreadyCount(): number {
  return (
    NAV_SECTIONS.filter((s) => !s.ready).length +
    NAV_FOOTER.filter((f) => !f.ready).length +
    PROJECT_TABS.filter((t) => !t.ready).length
  )
}
