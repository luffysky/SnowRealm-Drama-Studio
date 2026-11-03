/**
 * Editor modules.
 *
 * The editor is assembled from switchable modules rather than one fixed set of
 * TipTap extensions. A novel and a screenplay want different things — nobody
 * needs a table mid-scene, and nobody wants 場景標題 while writing prose — and
 * the pair of them will change their minds about which. A registry lets that
 * be a setting instead of an edit.
 *
 * This file is deliberately free of TipTap imports so a Server Component can
 * read the configuration without pulling ProseMirror into its bundle. The
 * extensions themselves are built in `src/components/editor/extensions.ts`.
 */

export const EDITOR_SURFACES = ['NOVEL', 'SCRIPT'] as const
export type EditorSurface = (typeof EDITOR_SURFACES)[number]

export const EDITOR_SURFACE_LABEL: Record<EditorSurface, string> = {
  NOVEL: '小說編輯器',
  SCRIPT: '劇本編輯器',
}

export const EDITOR_MODULE_IDS = [
  'core',
  'headings',
  'lists',
  'quote',
  'align',
  'marks',
  'link',
  'image',
  'table',
  'typography',
  'focus',
  'screenplay',
] as const
export type EditorModuleId = (typeof EDITOR_MODULE_IDS)[number]

export type EditorModule = {
  id: EditorModuleId
  label: string
  description: string
  /** Surfaces this module may be used on at all. */
  surfaces: readonly EditorSurface[]
  /** Surfaces where it starts enabled. */
  defaultOn: readonly EditorSurface[]
  /**
   * Cannot be switched off. Only paragraphs, history and the character count
   * qualify: without them there is no editor, just a box.
   */
  locked?: boolean
}

export const EDITOR_MODULES: readonly EditorModule[] = [
  {
    id: 'core',
    label: '基本文字',
    description: '段落、換行、復原重做、字數統計。這是編輯器本身，不能關閉。',
    surfaces: EDITOR_SURFACES,
    defaultOn: EDITOR_SURFACES,
    locked: true,
  },
  {
    id: 'headings',
    label: '標題層級',
    description: 'H1–H3。小說用來分節，劇本通常不需要。',
    surfaces: EDITOR_SURFACES,
    defaultOn: ['NOVEL'],
  },
  {
    id: 'lists',
    label: '清單',
    description: '項目符號、編號、待辦清單。',
    surfaces: EDITOR_SURFACES,
    defaultOn: ['NOVEL'],
  },
  {
    id: 'quote',
    label: '引言與分隔線',
    description: '引述區塊與水平分隔線，用來標示回憶或場景切換。',
    surfaces: EDITOR_SURFACES,
    defaultOn: ['NOVEL'],
  },
  {
    id: 'align',
    label: '對齊',
    description: '置左、置中、置右。劇本的轉場提示常用置右。',
    surfaces: EDITOR_SURFACES,
    defaultOn: ['SCRIPT'],
  },
  {
    id: 'marks',
    label: '強調標記',
    description: '粗體、斜體、底線、刪除線、螢光標記。',
    surfaces: EDITOR_SURFACES,
    defaultOn: EDITOR_SURFACES,
  },
  {
    id: 'link',
    label: '連結',
    description: '在稿子裡連到世界觀條目或參考資料。',
    surfaces: EDITOR_SURFACES,
    defaultOn: ['NOVEL'],
  },
  {
    id: 'image',
    label: '插入圖片',
    description: '插入已上傳的素材。圖片走 /api/files，不會外連到公開網址。',
    surfaces: EDITOR_SURFACES,
    defaultOn: [],
  },
  {
    id: 'table',
    label: '表格',
    description: '少用，但分場表或對照表偶爾需要。',
    surfaces: EDITOR_SURFACES,
    defaultOn: [],
  },
  {
    id: 'typography',
    label: '智慧標點',
    description: '自動把 -- 轉成破折號、... 轉成刪節號。',
    surfaces: EDITOR_SURFACES,
    defaultOn: EDITOR_SURFACES,
  },
  {
    id: 'focus',
    label: '專注模式',
    description: '淡化非當前段落，長時間寫作比較不費眼。',
    surfaces: EDITOR_SURFACES,
    defaultOn: [],
  },
  {
    id: 'screenplay',
    label: '劇本格式',
    description: '場景標題、角色名、對白、動作與轉場的專用樣式與快速鍵。',
    surfaces: ['SCRIPT'],
    defaultOn: ['SCRIPT'],
  },
]

export function modulesFor(surface: EditorSurface): readonly EditorModule[] {
  return EDITOR_MODULES.filter((module) => module.surfaces.includes(surface))
}

export function defaultModules(surface: EditorSurface): EditorModuleId[] {
  return EDITOR_MODULES.filter((module) => module.defaultOn.includes(surface)).map((m) => m.id)
}

export function isEditorModuleId(value: unknown): value is EditorModuleId {
  return typeof value === 'string' && (EDITOR_MODULE_IDS as readonly string[]).includes(value)
}

export function isEditorSurface(value: unknown): value is EditorSurface {
  return typeof value === 'string' && (EDITOR_SURFACES as readonly string[]).includes(value)
}

/**
 * Normalises a stored list: drops unknown ids, drops modules that do not apply
 * to this surface, and forces the locked ones back on.
 *
 * A setting edited by hand in the database should not be able to produce an
 * editor with no paragraphs in it.
 */
export function normaliseModules(
  surface: EditorSurface,
  ids: readonly unknown[]
): EditorModuleId[] {
  const allowed = new Set(modulesFor(surface).map((m) => m.id))
  const chosen = new Set(ids.filter(isEditorModuleId).filter((id) => allowed.has(id)))

  for (const entry of modulesFor(surface)) {
    if (entry.locked) chosen.add(entry.id)
  }

  // Registry order, so the toolbar is stable regardless of how it was stored.
  return EDITOR_MODULE_IDS.filter((id) => chosen.has(id))
}
