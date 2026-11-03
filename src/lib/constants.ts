/**
 * Single source of truth for the enum vocabularies the UI renders and the API
 * validates. Values mirror the Drizzle pgEnums in `src/db/schema/enums.ts`
 * exactly; the labels are the Traditional Chinese strings shown on screen.
 */

// ---------------------------------------------------------------------------
// 權限
// ---------------------------------------------------------------------------

export const ROLES = ['OWNER', 'COLLABORATOR'] as const
export type RoleValue = (typeof ROLES)[number]

export const ROLE_LABEL: Record<RoleValue, string> = {
  OWNER: '負責人',
  COLLABORATOR: '協作者',
}

export const ROLE_DESCRIPTION: Record<RoleValue, string> = {
  OWNER: '可編輯全部製作內容，並可管理成員、刪除作品與變更系統設定',
  COLLABORATOR: '可編輯全部製作內容，但不可管理成員或刪除作品',
}

// ---------------------------------------------------------------------------
// 作品 / 集數
// ---------------------------------------------------------------------------

/** Pipeline order — also the order the filter pills appear in (design 03). */
export const PROJECT_STATUSES = [
  'PLANNING',
  'IN_PRODUCTION',
  'POST_PRODUCTION',
  'COMPLETED',
  'RELEASED',
  'PAUSED',
  'ARCHIVED',
] as const
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_LABEL: Record<ProjectStatusValue, string> = {
  PLANNING: '企劃中',
  IN_PRODUCTION: '製作中',
  POST_PRODUCTION: '後製中',
  COMPLETED: '已完成',
  RELEASED: '已發行',
  PAUSED: '暫停',
  ARCHIVED: '封存',
}

export const PROJECT_STATUS_STYLE: Record<ProjectStatusValue, string> = {
  PLANNING: 'bg-stage-700/90 text-ink-200 ring-stage-600',
  IN_PRODUCTION: 'bg-accent-600/90 text-white ring-accent-400/60',
  POST_PRODUCTION: 'bg-indigo-600/90 text-white ring-indigo-400/60',
  COMPLETED: 'bg-emerald-600/90 text-white ring-emerald-400/60',
  RELEASED: 'bg-sky-600/90 text-white ring-sky-400/60',
  PAUSED: 'bg-amber-600/90 text-white ring-amber-400/60',
  ARCHIVED: 'bg-stage-800 text-ink-500 ring-stage-700',
}

/** Sort options offered by the 排序 dropdown on 作品列表. */
export const PROJECT_SORTS = ['UPDATED', 'CREATED', 'TITLE', 'PROGRESS'] as const
export type ProjectSortValue = (typeof PROJECT_SORTS)[number]

export const PROJECT_SORT_LABEL: Record<ProjectSortValue, string> = {
  UPDATED: '最新更新',
  CREATED: '建立時間',
  TITLE: '作品名稱',
  PROGRESS: '製作進度',
}

export const EPISODE_STATUSES = [
  'PLANNED',
  'WRITING',
  'STORYBOARD',
  'PRODUCTION',
  'REVIEW',
  'DONE',
  'ON_HOLD',
] as const
export type EpisodeStatusValue = (typeof EPISODE_STATUSES)[number]

export const EPISODE_STATUS_LABEL: Record<EpisodeStatusValue, string> = {
  PLANNED: '待開發',
  WRITING: '撰寫中',
  STORYBOARD: '分鏡中',
  PRODUCTION: '製作中',
  REVIEW: '審片中',
  DONE: '已完成',
  ON_HOLD: '暫停',
}

/** Chip classes for the dark workbench. Each is `bg / text / ring`. */
export const EPISODE_STATUS_STYLE: Record<EpisodeStatusValue, string> = {
  PLANNED: 'bg-stage-800 text-ink-400 ring-stage-700',
  WRITING: 'bg-sky-950 text-sky-300 ring-sky-800',
  STORYBOARD: 'bg-violet-950 text-violet-300 ring-violet-800',
  PRODUCTION: 'bg-amber-950 text-amber-300 ring-amber-800',
  REVIEW: 'bg-orange-950 text-orange-300 ring-orange-800',
  DONE: 'bg-emerald-950 text-emerald-300 ring-emerald-800',
  ON_HOLD: 'bg-rose-950 text-rose-300 ring-rose-800',
}

// ---------------------------------------------------------------------------
// 製作階段
// ---------------------------------------------------------------------------

/**
 * 製作階段的名稱、顏色與完成度規則全部移到 `src/lib/production.ts`
 * （spec v3 §11.2 的九階段固定鍵）。舊的 STAGES / STAGE_STATES 已移除，
 * 因為那套鍵值（IMAGE／VOICE／MUSIC／EDIT）不再存在於資料庫。
 */

// ---------------------------------------------------------------------------
// 分鏡
// ---------------------------------------------------------------------------

export const SHOT_SIZES = ['EWS', 'WS', 'FS', 'MS', 'MCU', 'CU', 'ECU', 'INSERT'] as const
export type ShotSizeValue = (typeof SHOT_SIZES)[number]

export const SHOT_SIZE_LABEL: Record<ShotSizeValue, string> = {
  EWS: '大遠景',
  WS: '遠景',
  FS: '全景',
  MS: '中景',
  MCU: '中近景',
  CU: '特寫',
  ECU: '大特寫',
  INSERT: '插入鏡',
}

export const CAMERA_MOVES = [
  'STATIC',
  'PAN',
  'TILT',
  'DOLLY_IN',
  'DOLLY_OUT',
  'TRACKING',
  'CRANE',
  'HANDHELD',
  'ZOOM',
] as const
export type CameraMoveValue = (typeof CAMERA_MOVES)[number]

export const CAMERA_MOVE_LABEL: Record<CameraMoveValue, string> = {
  STATIC: '固定',
  PAN: '橫搖',
  TILT: '直搖',
  DOLLY_IN: '推軌進',
  DOLLY_OUT: '推軌退',
  TRACKING: '跟拍',
  CRANE: '升降',
  HANDHELD: '手持',
  ZOOM: '變焦',
}

export const SHOT_STATUSES = [
  'TODO',
  'PROMPT_READY',
  'IMAGE_DONE',
  'VIDEO_DONE',
  'VOICE_DONE',
  'APPROVED',
  'RETAKE',
] as const
export type ShotStatusValue = (typeof SHOT_STATUSES)[number]

export const SHOT_STATUS_LABEL: Record<ShotStatusValue, string> = {
  TODO: '待處理',
  PROMPT_READY: '提示詞完成',
  IMAGE_DONE: '圖完成',
  VIDEO_DONE: '影片完成',
  VOICE_DONE: '配音完成',
  APPROVED: '已通過',
  RETAKE: '需重做',
}

export const SHOT_STATUS_STYLE: Record<ShotStatusValue, string> = {
  TODO: 'bg-stage-800 text-ink-400 ring-stage-700',
  PROMPT_READY: 'bg-sky-950 text-sky-300 ring-sky-800',
  IMAGE_DONE: 'bg-violet-950 text-violet-300 ring-violet-800',
  VIDEO_DONE: 'bg-indigo-950 text-indigo-300 ring-indigo-800',
  VOICE_DONE: 'bg-teal-950 text-teal-300 ring-teal-800',
  APPROVED: 'bg-emerald-950 text-emerald-300 ring-emerald-800',
  RETAKE: 'bg-rose-950 text-rose-300 ring-rose-800',
}

// ---------------------------------------------------------------------------
// 角色 / 世界觀
// ---------------------------------------------------------------------------

export const CHARACTER_TIERS = ['LEAD', 'SUPPORTING', 'MINOR', 'EXTRA'] as const
export type CharacterTierValue = (typeof CHARACTER_TIERS)[number]

export const CHARACTER_TIER_LABEL: Record<CharacterTierValue, string> = {
  LEAD: '主角',
  SUPPORTING: '配角',
  MINOR: '次要',
  EXTRA: '群演',
}

export const WORLD_CATEGORIES = [
  'DYNASTY',
  'GEOGRAPHY',
  'TRADE_ROUTE',
  'INSTITUTION',
  'CURRENCY',
  'TIME_TRAVEL_RULE',
  'FORESHADOWING',
  'CUISINE',
  'OTHER',
] as const
export type WorldCategoryValue = (typeof WORLD_CATEGORIES)[number]

export const WORLD_CATEGORY_LABEL: Record<WorldCategoryValue, string> = {
  DYNASTY: '王朝',
  GEOGRAPHY: '地理',
  TRADE_ROUTE: '商路',
  INSTITUTION: '制度',
  CURRENCY: '貨幣',
  TIME_TRAVEL_RULE: '穿越規則',
  FORESHADOWING: '伏筆',
  CUISINE: '飲食',
  OTHER: '其他',
}

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

export const ASSET_KINDS = [
  'IMAGE',
  'VIDEO',
  'MUSIC',
  'VOICE',
  'SFX',
  'NOVEL_ATTACHMENT',
  'STICKER',
  'DOC',
  'OTHER',
] as const
export type AssetKindValue = (typeof ASSET_KINDS)[number]

export const ASSET_KIND_LABEL: Record<AssetKindValue, string> = {
  IMAGE: '圖片',
  VIDEO: '影片',
  MUSIC: '音樂',
  VOICE: '配音',
  SFX: '音效',
  NOVEL_ATTACHMENT: '小說附件',
  STICKER: '貼圖',
  DOC: '文件',
  OTHER: '其他',
}

/** MIME prefixes each kind accepts. An empty list means anything is allowed. */
export const ASSET_KIND_ACCEPT: Record<AssetKindValue, readonly string[]> = {
  IMAGE: ['image/'],
  VIDEO: ['video/'],
  MUSIC: ['audio/'],
  VOICE: ['audio/'],
  SFX: ['audio/'],
  NOVEL_ATTACHMENT: ['text/', 'application/pdf', 'application/json'],
  STICKER: ['image/'],
  DOC: ['text/', 'application/pdf', 'application/json'],
  OTHER: [],
}

export const UPLOAD_STATUSES = ['PENDING', 'UPLOADING', 'COMPLETED', 'FAILED', 'ABORTED'] as const
export type UploadStatusValue = (typeof UPLOAD_STATUSES)[number]

export const UPLOAD_STATUS_LABEL: Record<UploadStatusValue, string> = {
  PENDING: '等待中',
  UPLOADING: '上傳中',
  COMPLETED: '完成',
  FAILED: '失敗',
  ABORTED: '已取消',
}

// ---------------------------------------------------------------------------
// 文件 / 版本
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = ['NOVEL', 'SCRIPT'] as const
export type DocumentKindValue = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_KIND_LABEL: Record<DocumentKindValue, string> = {
  NOVEL: '小說',
  SCRIPT: '劇本',
}

export const REVIEW_STATES = ['OPEN', 'CHANGES_REQUESTED', 'RESOLVED', 'APPROVED'] as const
export type ReviewStateValue = (typeof REVIEW_STATES)[number]

export const REVIEW_STATE_LABEL: Record<ReviewStateValue, string> = {
  OPEN: '待處理',
  CHANGES_REQUESTED: '要求修改',
  RESOLVED: '已解決',
  APPROVED: '已通過',
}

// ---------------------------------------------------------------------------
// 任務 / 成本
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['BACKLOG', 'TODO', 'DOING', 'REVIEW', 'DONE'] as const
export type TaskStatusValue = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_LABEL: Record<TaskStatusValue, string> = {
  BACKLOG: '待規劃',
  TODO: '待處理',
  DOING: '進行中',
  REVIEW: '待審核',
  DONE: '已完成',
}

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number]

export const TASK_PRIORITY_LABEL: Record<TaskPriorityValue, string> = {
  LOW: '低',
  NORMAL: '一般',
  HIGH: '高',
  URGENT: '緊急',
}

export const TASK_PRIORITY_STYLE: Record<TaskPriorityValue, string> = {
  LOW: 'bg-stage-800 text-ink-400 ring-stage-700',
  NORMAL: 'bg-sky-950 text-sky-300 ring-sky-800',
  HIGH: 'bg-amber-950 text-amber-300 ring-amber-800',
  URGENT: 'bg-rose-950 text-rose-300 ring-rose-800',
}

export const EXPENSE_CATEGORIES = [
  'AI_API',
  'SOFTWARE',
  'OUTSOURCING',
  'VOICE_TALENT',
  'MUSIC_LICENSE',
  'STOCK_FOOTAGE',
  'HARDWARE',
  'MARKETING',
  'OTHER',
] as const
export type ExpenseCategoryValue = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategoryValue, string> = {
  AI_API: 'AI API',
  SOFTWARE: '軟體訂閱',
  OUTSOURCING: '外包',
  VOICE_TALENT: '配音人員',
  MUSIC_LICENSE: '音樂授權',
  STOCK_FOOTAGE: '素材授權',
  HARDWARE: '硬體',
  MARKETING: '行銷',
  OTHER: '其他',
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const AI_PROVIDER_KINDS = [
  'ANTHROPIC',
  'IMAGE_GENERIC',
  'VIDEO_GENERIC',
  'TTS_GENERIC',
] as const
export type AiProviderKindValue = (typeof AI_PROVIDER_KINDS)[number]

export const AI_PROVIDER_KIND_LABEL: Record<AiProviderKindValue, string> = {
  ANTHROPIC: 'Claude（文字）',
  IMAGE_GENERIC: '圖片生成',
  VIDEO_GENERIC: '影片生成',
  TTS_GENERIC: '語音合成',
}

export const AI_JOB_KINDS = [
  'PROJECT_PLAN',
  'NOVEL_CONTINUE',
  'NOVEL_REWRITE',
  'NOVEL_POLISH',
  'NOVEL_REVIEW',
  'NOVEL_TO_SCRIPT',
  'SCRIPT_ANALYZE',
  'WORLD_GENERATE',
  'WORLD_CONSISTENCY',
  'CHARACTER_DESIGN',
  'STORYBOARD_GENERATE',
  'ASSET_GENERATE',
  'TASK_SUGGEST',
] as const
export type AiJobKindValue = (typeof AI_JOB_KINDS)[number]

export const AI_JOB_KIND_LABEL: Record<AiJobKindValue, string> = {
  PROJECT_PLAN: '作品企劃生成',
  NOVEL_CONTINUE: '小說續寫',
  NOVEL_REWRITE: '小說改寫',
  NOVEL_POLISH: '小說潤稿',
  NOVEL_REVIEW: '小說審稿',
  NOVEL_TO_SCRIPT: '小說轉劇本',
  SCRIPT_ANALYZE: '劇本分析',
  WORLD_GENERATE: '世界觀生成',
  WORLD_CONSISTENCY: '世界觀一致性檢查',
  CHARACTER_DESIGN: '角色設計與定妝',
  STORYBOARD_GENERATE: '分鏡生成',
  ASSET_GENERATE: '素材生成',
  TASK_SUGGEST: '任務建議',
}

export const AI_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'AWAITING_REVIEW',
] as const
export type AiJobStatusValue = (typeof AI_JOB_STATUSES)[number]

export const AI_JOB_STATUS_LABEL: Record<AiJobStatusValue, string> = {
  QUEUED: '等待中',
  RUNNING: '執行中',
  SUCCEEDED: '已套用',
  FAILED: '失敗',
  CANCELLED: '已取消',
  AWAITING_REVIEW: '待人工確認',
}

export const AI_JOB_STATUS_STYLE: Record<AiJobStatusValue, string> = {
  QUEUED: 'bg-stage-800 text-ink-400 ring-stage-700',
  RUNNING: 'bg-sky-950 text-sky-300 ring-sky-800',
  SUCCEEDED: 'bg-emerald-950 text-emerald-300 ring-emerald-800',
  FAILED: 'bg-rose-950 text-rose-300 ring-rose-800',
  CANCELLED: 'bg-stage-850 text-ink-500 ring-stage-700',
  AWAITING_REVIEW: 'bg-amber-950 text-amber-300 ring-amber-800',
}

// ---------------------------------------------------------------------------
// 上傳限制
// ---------------------------------------------------------------------------

/** Hard ceiling enforced server-side before any presigned URL is issued. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export const ACCEPTED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/'] as const

export const ACCEPTED_MIME_EXACT = [
  'application/pdf',
  'application/json',
  'application/zip',
] as const

// ---------------------------------------------------------------------------
// 專案常數
// ---------------------------------------------------------------------------

/** The live production. Used by the seed script. */
export const FLAGSHIP = {
  projectTitle: '一灶見山河',
  projectSlug: 'yi-zao-jian-shan-he',
  /** Settled genre facts about the show. Story content is deliberately absent. */
  tags: ['古風', '愛情', '權謀'] as const,
  arcIndex: 1,
  arcTitle: '萬家燈火',
  plannedEpisodes: 120,
  targetMinSec: 120,
  targetMaxSec: 180,
} as const

// ---------------------------------------------------------------------------
// 衍生素材 / 審核 / 時間線 / 用量 / 通知（spec v2 §5）
// ---------------------------------------------------------------------------

export const ASSET_VARIANT_KINDS = [
  'THUMBNAIL',
  'PREVIEW',
  'CROP',
  'BG_REMOVED',
  'UPSCALED',
  'WATERMARKED',
  'TRANSCODE',
  'WAVEFORM',
  'OTHER',
] as const
export type AssetVariantKindValue = (typeof ASSET_VARIANT_KINDS)[number]

export const ASSET_VARIANT_KIND_LABEL: Record<AssetVariantKindValue, string> = {
  THUMBNAIL: '縮圖',
  PREVIEW: '預覽',
  CROP: '裁切',
  BG_REMOVED: '去背',
  UPSCALED: '放大',
  WATERMARKED: '浮水印',
  TRANSCODE: '轉檔',
  WAVEFORM: '波形圖',
  OTHER: '其他',
}

export const APPROVAL_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'UNLOCKED'] as const
export type ApprovalStateValue = (typeof APPROVAL_STATES)[number]

export const APPROVAL_STATE_LABEL: Record<ApprovalStateValue, string> = {
  PENDING: '待審核',
  APPROVED: '已定稿',
  REJECTED: '退回修改',
  UNLOCKED: '已解鎖',
}

export const APPROVAL_STATE_STYLE: Record<ApprovalStateValue, string> = {
  PENDING: 'bg-amber-950 text-amber-300 ring-amber-800',
  // Gold is reserved for 定稿 — the one state that earns it.
  APPROVED: 'bg-gilt-400/15 text-gilt-300 ring-gilt-500/50',
  REJECTED: 'bg-rose-950 text-rose-300 ring-rose-800',
  UNLOCKED: 'bg-stage-800 text-ink-400 ring-stage-700',
}

export const WORLD_EVENT_SCOPES = [
  'BACKSTORY',
  'MAIN_TIMELINE',
  'PREVIOUS_LIFE',
  'FORESHADOWED',
] as const
export type WorldEventScopeValue = (typeof WORLD_EVENT_SCOPES)[number]

export const WORLD_EVENT_SCOPE_LABEL: Record<WorldEventScopeValue, string> = {
  BACKSTORY: '前情',
  MAIN_TIMELINE: '主線',
  PREVIOUS_LIFE: '前世',
  FORESHADOWED: '伏筆',
}

export const USAGE_SOURCES = ['AI_JOB', 'STORAGE', 'MANUAL'] as const
export type UsageSourceValue = (typeof USAGE_SOURCES)[number]

export const USAGE_SOURCE_LABEL: Record<UsageSourceValue, string> = {
  AI_JOB: 'AI 任務',
  STORAGE: '儲存空間',
  MANUAL: '手動登錄',
}

export const USAGE_KINDS = ['ESTIMATE', 'ACTUAL'] as const
export type UsageKindValue = (typeof USAGE_KINDS)[number]

export const USAGE_KIND_LABEL: Record<UsageKindValue, string> = {
  ESTIMATE: '預估',
  ACTUAL: '實際',
}

export const NOTIFICATION_KINDS = [
  'AI_JOB_DONE',
  'AI_JOB_FAILED',
  'REVIEW_REQUESTED',
  'APPROVAL_GRANTED',
  'TASK_ASSIGNED',
  'TASK_DUE',
  'BUDGET_WARNING',
  'MENTION',
  'SYSTEM',
] as const
export type NotificationKindValue = (typeof NOTIFICATION_KINDS)[number]

export const NOTIFICATION_KIND_LABEL: Record<NotificationKindValue, string> = {
  AI_JOB_DONE: 'AI 任務完成',
  AI_JOB_FAILED: 'AI 任務失敗',
  REVIEW_REQUESTED: '收到審稿請求',
  APPROVAL_GRANTED: '內容已定稿',
  TASK_ASSIGNED: '任務指派',
  TASK_DUE: '任務到期',
  BUDGET_WARNING: '預算警示',
  MENTION: '提及你',
  SYSTEM: '系統訊息',
}
