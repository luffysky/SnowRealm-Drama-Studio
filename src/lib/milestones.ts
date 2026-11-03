import { NAV_FOOTER, NAV_SECTIONS, PROJECT_TABS, type Milestone } from '@/lib/navigation'

/**
 * What each milestone still owes.
 *
 * Most of it is derived from the navigation tables, which already record
 * `ready` and `milestone` per entry — so a page that gets built stops being
 * listed here the moment its flag flips, with nothing to remember to update.
 *
 * The rest is declared below, because plenty of unbuilt work is not a
 * navigation entry: a dialog, a button, a column. Those need a hand-kept list,
 * and a hand-kept list drifts — so each one names where it is, which makes a
 * stale entry findable rather than merely wrong.
 */

export const MILESTONES: Milestone[] = ['M0', 'M1', 'M2', 'M3', 'M4']

export const MILESTONE_SUMMARY: Record<Milestone, string> = {
  M0: '基礎建設：登入、資料庫、R2、部署',
  M1: '作品與集數：列表、總覽、集數管理',
  M2: '寫作與 AI：小說、劇本、大綱、AI 協作',
  M3: '視覺製作：分鏡、素材資產中心',
  M4: '協作與發行：審核、任務、成本、團隊、設定',
}

export type MilestoneItem = {
  label: string
  /** Where it lives, so a stale entry can be found rather than just wrong. */
  where: string
  done: boolean
}

/**
 * Work that is not a navigation entry.
 *
 * Kept deliberately short. Anything that *is* a page belongs in the navigation
 * tables, where its state is already tracked.
 */
const EXTRA: Record<Milestone, MilestoneItem[]> = {
  M0: [
    { label: '登入與 session', where: '/login', done: true },
    { label: 'Neon 資料庫與 migration', where: 'drizzle/', done: true },
    { label: 'R2 上傳管線（直傳、多段、重試）', where: 'src/lib/r2.ts', done: true },
    { label: '缺少的視覺資產（登入背景、Logo、側欄插圖、首頁橫幅）', where: 'public/', done: false },
  ],
  M1: [
    { label: '新增作品表單', where: '作品列表 → 新增作品', done: true },
    { label: '作品卡的「更多操作」', where: '作品列表卡片', done: false },
    { label: '集數編輯', where: '集數管理 → 單集', done: false },
    { label: '集數詳情頁', where: '集數管理 → 單集', done: false },
    { label: '集數列表的其他檢視模式', where: '集數管理 → 檢視切換', done: false },
  ],
  M2: [
    { label: '小說編輯器（TipTap、模組化）', where: '小說編輯', done: true },
    { label: '劇本編輯器', where: '劇本工坊', done: true },
    { label: '分集大綱與 AI 生成', where: '小說編輯 → 分集大綱', done: true },
    { label: 'AI 創作助手（估算→產生→比對→採用）', where: '編輯器右側', done: true },
    { label: 'AI 提示詞範本（設計 38–43）', where: '未建立', done: false },
    { label: 'AI 比較檢視細項（設計 44–49）', where: '未建立', done: false },
    { label: '小說轉劇本完整流程（設計 50–56）', where: '未建立', done: false },
  ],
  M3: [
    { label: '素材資產中心 Schema', where: 'drizzle/0013', done: true },
    { label: '鏡頭詳情（設計 13）', where: '未建立', done: false },
    { label: '素材中心頁面（設計 81–90）', where: '未建立', done: false },
    { label: '影片／圖片／語音生成供應商', where: 'src/lib/ai/registry.ts', done: false },
    {
      label: '集數成片（尚無欄位可存）',
      where: 'episodes 表',
      done: false,
    },
  ],
  M4: [
    { label: '通知中心', where: '頂列鈴鐺', done: false },
    { label: '說明中心', where: '頂列問號', done: false },
    { label: '完整動態列表', where: '作品列表 → 近期動態', done: false },
  ],
}

export type MilestoneReport = {
  milestone: Milestone
  summary: string
  done: MilestoneItem[]
  todo: MilestoneItem[]
}

export function milestoneReport(milestone: Milestone): MilestoneReport {
  const items: MilestoneItem[] = []

  for (const section of NAV_SECTIONS) {
    if (section.milestone === milestone || (!section.milestone && section.ready)) {
      if (section.milestone === milestone) {
        items.push({ label: section.label, where: '側欄', done: section.ready })
      }
    }
  }

  for (const leaf of NAV_FOOTER) {
    if (leaf.milestone === milestone) {
      items.push({ label: leaf.label, where: '側欄', done: leaf.ready })
    }
  }

  for (const tab of PROJECT_TABS) {
    if (tab.milestone === milestone) {
      items.push({
        label: tab.label,
        where: '作品分頁',
        done: tab.ready,
      })
    }
  }

  items.push(...(EXTRA[milestone] ?? []))

  return {
    milestone,
    summary: MILESTONE_SUMMARY[milestone],
    done: items.filter((item) => item.done),
    todo: items.filter((item) => !item.done),
  }
}

export function allMilestoneReports(): MilestoneReport[] {
  return MILESTONES.map(milestoneReport)
}
