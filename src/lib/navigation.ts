/**
 * The studio's navigation tree, transcribed from the reference art in
 * `UI Design/` (01_dashboard, 05_episodes).
 *
 * One source for both chromes: the top bar renders the sections, the sidebar
 * renders the same tree expanded. Keeping them in one place is what stops the
 * two drifting apart as pages land.
 *
 * `ready` gates whether an entry is a link at all. Spec v2 §4 is explicit —
 * 「圖中按鈕必須真能操作；尚未串接的功能應禁用並顯示原因，不做空按鈕」 — so an
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
  /** Where the top-bar tab points. */
  href: string
  ready: boolean
  milestone?: Milestone
  design?: number
  children?: NavLeaf[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'dashboard',
    label: '總儀表板',
    icon: 'LayoutDashboard',
    href: '/dashboard',
    ready: true,
    design: 1,
  },
  {
    key: 'studio',
    label: '製片中心',
    icon: 'Clapperboard',
    href: '/studio',
    ready: false,
    milestone: 'M1',
  },
  {
    key: 'projects',
    label: '作品列表',
    icon: 'Film',
    href: '/projects',
    ready: false,
    milestone: 'M1',
    design: 3,
    children: [
      { key: 'projects-overview', label: '作品總覽', href: '/projects', ready: false, milestone: 'M1', design: 4 },
      { key: 'episodes', label: '集數列表', href: '/projects/_/episodes', ready: false, milestone: 'M1', design: 5 },
      { key: 'arcs', label: '分集管理', href: '/projects/_/arcs', ready: false, milestone: 'M1' },
      { key: 'versions', label: '版本紀錄', href: '/projects/_/versions', ready: false, milestone: 'M2', design: 8 },
    ],
  },
  {
    key: 'story',
    label: '故事創作',
    icon: 'PenLine',
    href: '/story',
    ready: false,
    milestone: 'M2',
    children: [
      { key: 'novel', label: '小說編輯器', href: '/story/novel', ready: false, milestone: 'M2', design: 6 },
      { key: 'script', label: '劇本編輯器', href: '/story/script', ready: false, milestone: 'M2', design: 7 },
    ],
  },
  {
    key: 'world',
    label: '世界觀',
    icon: 'BookOpen',
    href: '/world',
    ready: false,
    milestone: 'M2',
    children: [
      { key: 'world-settings', label: '世界觀設定', href: '/world/settings', ready: false, milestone: 'M2', design: 9 },
      { key: 'characters', label: '角色資料庫', href: '/world/characters', ready: false, milestone: 'M2', design: 10 },
    ],
  },
  {
    key: 'visual',
    label: '視覺製作',
    icon: 'Layers',
    href: '/visual',
    ready: false,
    milestone: 'M3',
    children: [
      { key: 'storyboard', label: '分鏡工作台', href: '/visual/storyboard', ready: false, milestone: 'M3', design: 12 },
      { key: 'assets', label: '素材管理', href: '/visual/assets', ready: false, milestone: 'M3', design: 14 },
    ],
  },
  {
    key: 'collab',
    label: '協作管理',
    icon: 'Users',
    href: '/collab',
    ready: false,
    milestone: 'M4',
    children: [
      { key: 'tasks', label: '任務看板', href: '/collab/tasks', ready: false, milestone: 'M4', design: 18 },
      { key: 'reviews', label: '審核中心', href: '/collab/reviews', ready: false, milestone: 'M4', design: 58 },
    ],
  },
  {
    key: 'costs',
    label: '成本紀錄',
    icon: 'Receipt',
    href: '/costs',
    ready: false,
    milestone: 'M4',
    design: 23,
  },
  {
    key: 'settings',
    label: '專案設定',
    icon: 'Settings',
    href: '/settings',
    ready: false,
    milestone: 'M4',
    design: 21,
  },
]

/** Sidebar-only entries, pinned to the foot of the tree. */
export const NAV_FOOTER: NavLeaf[] = [
  { key: 'profile', label: '個人設定', href: '/settings/profile', ready: false, milestone: 'M4', design: 22 },
]

/** The section a pathname belongs to, for highlighting the top bar. */
export function activeSectionKey(pathname: string): string | null {
  for (const section of NAV_SECTIONS) {
    if (pathname === section.href || pathname.startsWith(`${section.href}/`)) {
      return section.key
    }
    for (const child of section.children ?? []) {
      const base = child.href.split('/_')[0] ?? child.href
      if (pathname.startsWith(base)) return section.key
    }
  }
  return null
}

export function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** How many entries are still unbuilt, shown in the shell's build-status note. */
export function unreadyCount(): number {
  let n = 0
  for (const section of NAV_SECTIONS) {
    if (!section.ready) n += 1
    for (const child of section.children ?? []) if (!child.ready) n += 1
  }
  return n + NAV_FOOTER.filter((f) => !f.ready).length
}
