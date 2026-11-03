import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Every enum the schema uses. Values are UPPER_SNAKE and are mirrored by the
 * label maps in `src/lib/constants.ts`, which the UI renders.
 */

/** Both real members are OWNER today; the column exists so a narrower role can be added without a migration of meaning. */
export const roleEnum = pgEnum('role', ['OWNER', 'COLLABORATOR'])

/**
 * 作品狀態. Ordered as the pipeline runs, which is also the order the filter
 * pills appear in on the 作品列表 page (design 03).
 */
export const projectStatusEnum = pgEnum('project_status', [
  'PLANNING',
  'IN_PRODUCTION',
  'POST_PRODUCTION',
  'COMPLETED',
  'RELEASED',
  'PAUSED',
  'ARCHIVED',
])

export const episodeStatusEnum = pgEnum('episode_status', [
  'PLANNED',
  'WRITING',
  'STORYBOARD',
  'PRODUCTION',
  'REVIEW',
  'DONE',
  'ON_HOLD',
])

export const documentKindEnum = pgEnum('document_kind', ['NOVEL', 'SCRIPT'])

/** A version snapshot can belong to any of these document-like records. */
export const versionTargetEnum = pgEnum('version_target', [
  'DOCUMENT',
  'SHOT',
  'CHARACTER',
  'WORLD_ENTRY',
  'ASSET',
])

export const reviewStateEnum = pgEnum('review_state', [
  'OPEN',
  'CHANGES_REQUESTED',
  'RESOLVED',
  'APPROVED',
])

export const worldCategoryEnum = pgEnum('world_category', [
  'DYNASTY',
  'GEOGRAPHY',
  'TRADE_ROUTE',
  'INSTITUTION',
  'CURRENCY',
  'TIME_TRAVEL_RULE',
  'FORESHADOWING',
  'CUISINE',
  'OTHER',
])

export const characterTierEnum = pgEnum('character_tier', [
  'LEAD',
  'SUPPORTING',
  'MINOR',
  'EXTRA',
])

/** 景別 */
export const shotSizeEnum = pgEnum('shot_size', [
  'EWS',
  'WS',
  'FS',
  'MS',
  'MCU',
  'CU',
  'ECU',
  'INSERT',
])

/** 運鏡 */
export const cameraMoveEnum = pgEnum('camera_move', [
  'STATIC',
  'PAN',
  'TILT',
  'DOLLY_IN',
  'DOLLY_OUT',
  'TRACKING',
  'CRANE',
  'HANDHELD',
  'ZOOM',
])

export const shotStatusEnum = pgEnum('shot_status', [
  'TODO',
  'PROMPT_READY',
  'IMAGE_DONE',
  'VIDEO_DONE',
  'VOICE_DONE',
  'APPROVED',
  'RETAKE',
])

/** 圖片、影片、音樂、配音、小說附件、貼圖 — plus a catch-all. */
export const assetKindEnum = pgEnum('asset_kind', [
  'IMAGE',
  'VIDEO',
  'MUSIC',
  'VOICE',
  'SFX',
  'NOVEL_ATTACHMENT',
  'STICKER',
  'DOC',
  'OTHER',
])

/** Lifecycle of one upload into R2. Only COMPLETED rows are user-visible assets. */
export const uploadStatusEnum = pgEnum('upload_status', [
  'PENDING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
])

export const stageEnum = pgEnum('stage', [
  'NOVEL',
  'SCRIPT',
  'STORYBOARD',
  'IMAGE',
  'VIDEO',
  'VOICE',
  'MUSIC',
  'EDIT',
  'REVIEW',
])

export const stageStateEnum = pgEnum('stage_state', ['TODO', 'DOING', 'BLOCKED', 'DONE'])

/** 任務看板的五個狀態 */
export const taskStatusEnum = pgEnum('task_status', [
  'BACKLOG',
  'TODO',
  'DOING',
  'REVIEW',
  'DONE',
])

export const taskPriorityEnum = pgEnum('task_priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT'])

export const expenseCategoryEnum = pgEnum('expense_category', [
  'AI_API',
  'SOFTWARE',
  'OUTSOURCING',
  'VOICE_TALENT',
  'MUSIC_LICENSE',
  'STOCK_FOOTAGE',
  'HARDWARE',
  'MARKETING',
  'OTHER',
])

/** Pluggable AI backends. The adapter for each lives in src/lib/ai/. */
export const aiProviderKindEnum = pgEnum('ai_provider_kind', [
  'ANTHROPIC',
  'IMAGE_GENERIC',
  'VIDEO_GENERIC',
  'TTS_GENERIC',
])

/** What an AI job was asked to do. Drives which adapter method runs. */
export const aiJobKindEnum = pgEnum('ai_job_kind', [
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
])

export const aiJobStatusEnum = pgEnum('ai_job_status', [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  /** Finished, but a human has not accepted the output into the real record yet. */
  'AWAITING_REVIEW',
])

export const exportKindEnum = pgEnum('export_kind', [
  'NOVEL',
  'SCRIPT',
  'STORYBOARD',
  'COST_REPORT',
])

export const exportStatusEnum = pgEnum('export_status', [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
])

/** Audit kinds recorded in `security_events`. Never includes credential material. */
export const securityEventKindEnum = pgEnum('security_event_kind', [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_RATE_LIMITED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  /// A bcrypt hash was replaced with Argon2id after a successful login.
  'PASSWORD_REHASHED',
  'SESSION_REVOKED',
])

// ---------------------------------------------------------------------------
// spec v2 §5 — remaining domains
// ---------------------------------------------------------------------------

/**
 * Derivative kinds stored in `asset_variants`. The original upload is never
 * one of these: it stays in `assets` untouched (spec v2 §6.2).
 */
export const assetVariantKindEnum = pgEnum('asset_variant_kind', [
  'THUMBNAIL',
  'PREVIEW',
  'CROP',
  'BG_REMOVED',
  'UPSCALED',
  'WATERMARKED',
  'TRANSCODE',
  'WAVEFORM',
  'OTHER',
])

/** 定稿審核狀態 (spec v2 §5 `approval_records`, §6.5). */
export const approvalStateEnum = pgEnum('approval_state', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  /// Approved content deliberately reopened for revision.
  'UNLOCKED',
])

/** What a world event is anchored to on the timeline. */
export const worldEventScopeEnum = pgEnum('world_event_scope', [
  'BACKSTORY',
  'MAIN_TIMELINE',
  'PREVIOUS_LIFE',
  'FORESHADOWED',
])

/** Where a line in `usage_ledger` came from. */
export const usageSourceEnum = pgEnum('usage_source', [
  'AI_JOB',
  'STORAGE',
  'MANUAL',
])

/** Whether a ledger line is a forecast or a settled charge (spec v2 §6.7). */
export const usageKindEnum = pgEnum('usage_kind', ['ESTIMATE', 'ACTUAL'])

export const notificationKindEnum = pgEnum('notification_kind', [
  'AI_JOB_DONE',
  'AI_JOB_FAILED',
  'REVIEW_REQUESTED',
  'APPROVAL_GRANTED',
  'TASK_ASSIGNED',
  'TASK_DUE',
  'BUDGET_WARNING',
  'MENTION',
  'SYSTEM',
])
