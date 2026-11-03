import { describe, expect, it } from 'vitest'
import {
  activeProjectTabKey,
  activeSectionKey,
  isActiveHref,
  NAV_FOOTER,
  NAV_SECTIONS,
  PROJECT_TABS,
  projectTabHref,
} from '@/lib/navigation'

/**
 * Guards the B+ split (`docs/ROUTES.md`): the global rail is cross-project
 * only, and everything needing a projectId lives in the workspace tabs.
 *
 * These are cheap assertions about a data structure, but they are the ones
 * that fail the moment someone adds 小說編輯器 back to the rail — which is
 * exactly the mistake the architecture exists to prevent.
 */

const PROJECT_ID = '935dc410-79dc-48df-8834-887e9dc59597'

describe('global rail', () => {
  it('contains nothing that needs a projectId', () => {
    for (const section of [...NAV_SECTIONS, ...NAV_FOOTER]) {
      expect(section.href).not.toContain('[')
      expect(section.href).not.toContain('/_')
      expect(section.href).not.toMatch(/^\/projects\/./)
    }
  })

  it('never links to an unbuilt page', () => {
    for (const section of [...NAV_SECTIONS, ...NAV_FOOTER]) {
      // spec v2 §4: an unbuilt entry is disabled with its milestone, not a
      // link to a 404.
      if (!section.ready) expect(section.milestone).toBeTruthy()
    }
  })

  it('uses unique keys and hrefs', () => {
    const keys = NAV_SECTIONS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)

    const hrefs = NAV_SECTIONS.map((s) => s.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('highlights the most specific section', () => {
    expect(activeSectionKey('/dashboard')).toBe('dashboard')
    expect(activeSectionKey('/projects')).toBe('projects')
    // A project workspace still belongs to 作品列表 in the rail.
    expect(activeSectionKey(`/projects/${PROJECT_ID}/episodes`)).toBe('projects')
    expect(activeSectionKey('/nowhere')).toBeNull()
  })

  it('does not treat a prefix match as the same route', () => {
    expect(isActiveHref('/projects', '/projects')).toBe(true)
    expect(isActiveHref('/projects/x', '/projects')).toBe(true)
    expect(isActiveHref('/projectsfoo', '/projects')).toBe(false)
  })
})

describe('project workspace tabs', () => {
  it('builds hrefs under the project, with the overview at the root', () => {
    const overview = PROJECT_TABS.find((t) => t.key === 'overview')!
    expect(projectTabHref(PROJECT_ID, overview)).toBe(`/projects/${PROJECT_ID}`)

    for (const tab of PROJECT_TABS) {
      expect(projectTabHref(PROJECT_ID, tab)).toMatch(new RegExp(`^/projects/${PROJECT_ID}`))
    }
  })

  it('uses unique keys and segments', () => {
    const keys = PROJECT_TABS.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)

    const segments = PROJECT_TABS.map((t) => t.segment)
    expect(new Set(segments).size).toBe(segments.length)
  })

  it('marks every unbuilt tab with a milestone', () => {
    for (const tab of PROJECT_TABS) {
      if (!tab.ready) expect(tab.milestone).toBeTruthy()
    }
  })

  it('reads the active tab from the URL alone', () => {
    // docs/ROUTES.md §4 — no stored "current project" is consulted.
    expect(activeProjectTabKey(`/projects/${PROJECT_ID}`, PROJECT_ID)).toBe('overview')
    expect(activeProjectTabKey(`/projects/${PROJECT_ID}/episodes`, PROJECT_ID)).toBe('episodes')
    expect(activeProjectTabKey(`/projects/${PROJECT_ID}/episodes/12`, PROJECT_ID)).toBe('episodes')
  })

  it('highlights the editor the writer is in, not 集數管理', () => {
    /*
     * The per-episode editors hang off `/episodes/[id]`, but the writer is in
     * the novel or the script. Highlighting 集數管理 while they are plainly
     * writing prose reads as "it keeps sending me back to the episode list".
     */
    const episode = '22222222-2222-4222-8222-222222222222'

    expect(
      activeProjectTabKey(`/projects/${PROJECT_ID}/episodes/${episode}/novel`, PROJECT_ID)
    ).toBe('novel')
    expect(
      activeProjectTabKey(`/projects/${PROJECT_ID}/episodes/${episode}/script`, PROJECT_ID)
    ).toBe('scripts')

    // The list itself, and an episode detail route, still belong to 集數管理.
    expect(activeProjectTabKey(`/projects/${PROJECT_ID}/episodes/${episode}`, PROJECT_ID)).toBe(
      'episodes'
    )
  })

  it('returns null for another project or an unknown segment', () => {
    const other = '11111111-1111-4111-8111-111111111111'
    expect(activeProjectTabKey(`/projects/${other}/episodes`, PROJECT_ID)).toBeNull()
    expect(activeProjectTabKey(`/projects/${PROJECT_ID}/nonsense`, PROJECT_ID)).toBeNull()
    expect(activeProjectTabKey('/dashboard', PROJECT_ID)).toBeNull()
  })
})
