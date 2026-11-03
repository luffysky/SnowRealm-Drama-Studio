import { z } from 'zod'
import { EDITOR_SURFACES } from '@/lib/editor/modules'
import { CURRENCIES } from '@/lib/money'
import { PRODUCTION_STAGE_KEYS, PRODUCTION_STAGE_STATUSES } from '@/lib/production'
import {
  ASSET_KINDS,
  CAMERA_MOVES,
  CHARACTER_TIERS,
  DOCUMENT_KINDS,
  EPISODE_STATUSES,
  MAX_UPLOAD_BYTES,
  SHOT_SIZES,
  SHOT_STATUSES,
  WORLD_CATEGORIES,
  WORLD_EVENT_SCOPES,
} from './constants'
import { PASSWORD_MIN_LENGTH } from './auth/password'

/** Request schemas. Every mutating route validates its body through one of these. */

export const uuid = z.string().uuid('識別碼格式不正確')

/**
 * A member signs in with either their handle (`Niannian`) or their email
 * address, so this field is not validated as an email — the server decides
 * which column to match on.
 *
 * `email` is still accepted as an alias so older clients and the smoke test
 * keep working; whichever arrives is normalised to `identifier`.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1, '請輸入帳號').optional(),
    email: z.string().trim().min(1, '請輸入帳號').optional(),
    password: z.string().min(1, '請輸入密碼'),
    remember: z.boolean().optional().default(true),
  })
  .transform((value) => ({
    identifier: (value.identifier ?? value.email ?? '').trim(),
    password: value.password,
    remember: value.remember,
  }))
  .refine((value) => value.identifier.length > 0, {
    message: '請輸入帳號',
    path: ['identifier'],
  })
export type LoginInput = z.infer<typeof loginSchema>

/**
 * A login handle: letters, digits, dot, dash and underscore. Deliberately
 * narrow — it goes in a URL-ish place eventually and must not collide with an
 * email address, so an `@` is rejected.
 */
export const accountHandleSchema = z
  .string()
  .trim()
  .min(3, '帳號至少需要 3 個字元')
  .max(32, '帳號最多 32 個字元')
  .regex(/^[A-Za-z0-9._-]+$/, '帳號只能使用英數字與 . _ -')

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '請輸入目前的密碼'),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `新密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`),
    confirmPassword: z.string().min(1, '請再次輸入新密碼'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: '兩次輸入的新密碼不一致',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: '新密碼不可與目前的密碼相同',
    path: ['newPassword'],
  })

export const profileSchema = z.object({
  name: z.string().trim().min(1, '請輸入顯示名稱').max(40),
  title: z.string().trim().max(40).optional().default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '請使用 #RRGGBB 格式的色碼')
    .optional(),
})

export const projectSchema = z.object({
  title: z.string().trim().min(1, '請輸入作品名稱').max(80),
  logline: z.string().trim().max(300).optional().default(''),
  synopsis: z.string().trim().max(5000).optional().default(''),
  genre: z.string().trim().max(60).optional().default(''),
  targetMinSec: z.coerce.number().int().min(10).max(3600).optional().default(120),
  targetMaxSec: z.coerce.number().int().min(10).max(3600).optional().default(180),
})
  .refine((v) => v.targetMinSec <= v.targetMaxSec, {
    message: '片長下限不可大於上限',
    path: ['targetMinSec'],
  })

export const arcSchema = z.object({
  projectId: uuid,
  index: z.coerce.number().int().min(1).max(99),
  title: z.string().trim().min(1, '請輸入篇章名稱').max(80),
  logline: z.string().trim().max(300).optional().default(''),
  synopsis: z.string().trim().max(5000).optional().default(''),
  plannedEpisodes: z.coerce.number().int().min(1).max(999).optional().default(120),
})

export const episodeSchema = z.object({
  arcId: uuid,
  number: z.coerce.number().int().min(1).max(999),
  title: z.string().trim().max(120).optional().default(''),
  logline: z.string().trim().max(300).optional().default(''),
  synopsis: z.string().trim().max(5000).optional().default(''),
  targetSec: z.coerce.number().int().min(10).max(3600).optional().default(150),
  status: z.enum(EPISODE_STATUSES).optional().default('PLANNED'),
  notes: z.string().trim().max(2000).optional().default(''),
})

/** 批次建立集數 — e.g. episodes 1..120 in one call. */
export const episodeBatchSchema = z
  .object({
    arcId: uuid,
    from: z.coerce.number().int().min(1).max(999),
    to: z.coerce.number().int().min(1).max(999),
    targetSec: z.coerce.number().int().min(10).max(3600).optional().default(150),
    /** `{n}` is replaced by the episode number. */
    titleTemplate: z.string().trim().max(120).optional().default(''),
    /** Skip numbers that already exist instead of failing the whole batch. */
    skipExisting: z.boolean().optional().default(true),
  })
  .refine((v) => v.from <= v.to, { message: '起始集數不可大於結束集數', path: ['from'] })
  .refine((v) => v.to - v.from < 500, { message: '單次最多建立 500 集', path: ['to'] })

export const episodeBulkUpdateSchema = z.object({
  episodeIds: z.array(uuid).min(1, '請至少選擇一集').max(500),
  status: z.enum(EPISODE_STATUSES).optional(),
  targetSec: z.coerce.number().int().min(10).max(3600).optional(),
  assigneeId: uuid.nullable().optional(),
  stage: z.enum(PRODUCTION_STAGE_KEYS).optional(),
  stageState: z.enum(PRODUCTION_STAGE_STATUSES).optional(),
})

export const documentSaveSchema = z.object({
  episodeId: uuid,
  kind: z.enum(DOCUMENT_KINDS),
  content: z.string().max(400_000, '內容超過單集上限（40 萬字元）'),
  /** The version the editor loaded; a mismatch means the other member saved first. */
  baseVersion: z.coerce.number().int().min(1).optional(),
  label: z.string().trim().max(120).optional().default(''),
})

export const characterSchema = z.object({
  projectId: uuid,
  name: z.string().trim().min(1, '請輸入角色名稱').max(60),
  alias: z.string().trim().max(120).optional().default(''),
  tier: z.enum(CHARACTER_TIERS).optional().default('SUPPORTING'),
  age: z.string().trim().max(40).optional().default(''),
  gender: z.string().trim().max(20).optional().default(''),
  appearance: z.string().trim().max(3000).optional().default(''),
  personality: z.string().trim().max(3000).optional().default(''),
  background: z.string().trim().max(5000).optional().default(''),
  growth: z.string().trim().max(3000).optional().default(''),
  visualPrompt: z.string().trim().max(3000).optional().default(''),
  negativePrompt: z.string().trim().max(1500).optional().default(''),
  voiceProvider: z.string().trim().max(60).optional().default(''),
  voiceId: z.string().trim().max(120).optional().default(''),
  voiceStyle: z.string().trim().max(200).optional().default(''),
  voiceNote: z.string().trim().max(1000).optional().default(''),
  keyVisualAssetId: uuid.nullable().optional(),
  voiceSampleAssetId: uuid.nullable().optional(),
})

export const shotSchema = z.object({
  episodeId: uuid,
  order: z.coerce.number().int().min(1).max(999).optional(),
  sceneId: uuid.nullable().optional(),
  sceneCode: z.string().trim().max(20).optional().default(''),
  durationSec: z.coerce
    .number()
    .int()
    .min(1, '鏡頭長度至少 1 秒')
    .max(120, '單一鏡頭不可超過 120 秒'),
  shotSize: z.enum(SHOT_SIZES).optional().default('MS'),
  camera: z.enum(CAMERA_MOVES).optional().default('STATIC'),
  location: z.string().trim().max(120).optional().default(''),
  timeOfDay: z.string().trim().max(40).optional().default(''),
  action: z.string().trim().max(3000).optional().default(''),
  dialogue: z.string().trim().max(3000).optional().default(''),
  speakerId: uuid.nullable().optional(),
  prompt: z.string().trim().max(4000).optional().default(''),
  negativePrompt: z.string().trim().max(2000).optional().default(''),
  refAssetId: uuid.nullable().optional(),
  firstFrameAssetId: uuid.nullable().optional(),
  lastFrameAssetId: uuid.nullable().optional(),
  imageAssetId: uuid.nullable().optional(),
  videoAssetId: uuid.nullable().optional(),
  voiceAssetId: uuid.nullable().optional(),
  status: z.enum(SHOT_STATUSES).optional().default('TODO'),
  notes: z.string().trim().max(2000).optional().default(''),
})

export const shotReorderSchema = z.object({
  episodeId: uuid,
  /** Shot ids in their new order; index + 1 becomes `order`. */
  shotIds: z.array(uuid).min(1).max(999),
})

/**
 * 作品設定 (rename + cover).
 *
 * Every field is optional, but at least one must be present: an empty PATCH
 * would otherwise bump `updated_at` and log an activity for nothing.
 *
 * `novelTitle` and `dramaTitle` may legitimately be empty strings — that is
 * how「跟作品名稱相同」is stored — so they are trimmed but not length-checked
 * at the bottom. `title` may not be: a work with no name is not a state worth
 * being able to save.
 */
export const projectUpdateSchema = z
  .object({
    title: z.string().trim().min(1, '作品名稱不能空白').max(120).optional(),
    novelTitle: z.string().trim().max(120).optional(),
    dramaTitle: z.string().trim().max(120).optional(),
    logline: z.string().trim().max(400).optional(),
    synopsis: z.string().trim().max(8000).optional(),
    /** null clears the cover. */
    coverAssetId: uuid.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '沒有要變更的欄位' })

/** Step 1 of an upload: ask the server for a presigned destination. */
export const uploadRequestSchema = z.object({
  projectId: uuid,
  episodeId: uuid.nullable().optional(),
  kind: z.enum(ASSET_KINDS),
  filename: z.string().trim().min(1, '缺少檔名').max(255),
  contentType: z.string().trim().max(160).optional().default(''),
  sizeBytes: z.coerce
    .number()
    .int()
    .min(1, '檔案大小必須大於 0')
    .max(MAX_UPLOAD_BYTES, '檔案超過上限'),
  /** Attach the finished asset to a shot / character / task. */
  linkTo: z
    .object({
      entityType: z.enum(['shot', 'character', 'task', 'world_entry', 'document', 'expense']),
      entityId: uuid,
      slot: z.string().trim().max(40).optional().default(''),
    })
    .optional(),
  /** Creates the next version of an existing asset rather than a new one. */
  rootAssetId: uuid.nullable().optional(),
})

/** Step 1 of a preview upload: ask for a presigned destination. */
export const previewBeginSchema = z.object({
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.coerce.number().int().min(1).max(8 * 1024 * 1024),
  width: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
  height: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
  /** How it was produced: encoder, quality, scale. Kept for provenance. */
  params: z.record(z.string(), z.unknown()).optional(),
})

export const previewCompleteSchema = z.object({
  variantId: uuid,
})

export const uploadCompleteSchema = z.object({
  uploadSessionId: uuid,
  /** Required for a multipart upload; omitted for a single PUT. */
  parts: z
    .array(
      z.object({
        partNumber: z.coerce.number().int().min(1).max(10_000),
        etag: z.string().trim().min(1),
      })
    )
    .optional(),
})

export const uploadPartsSchema = z.object({
  uploadSessionId: uuid,
  partNumbers: z.array(z.coerce.number().int().min(1).max(10_000)).min(1).max(1000),
})

export const assetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  note: z.string().trim().max(2000).optional(),
  license: z.string().trim().max(200).optional(),
  episodeId: uuid.nullable().optional(),
})

export const stageUpdateSchema = z.object({
  episodeId: uuid,
  stage: z.enum(PRODUCTION_STAGE_KEYS),
  state: z.enum(PRODUCTION_STAGE_STATUSES),
  assigneeId: uuid.nullable().optional(),
  note: z.string().trim().max(1000).optional(),
})

export const aiRunSchema = z.object({
  task: z.enum([
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
  ]),
  projectId: uuid.nullable().optional(),
  episodeId: uuid.nullable().optional(),
  providerId: uuid.nullable().optional(),
  model: z.string().trim().max(80).optional(),
  candidates: z.coerce.number().int().min(1).max(3).optional().default(1),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  maxTokens: z.coerce.number().int().min(256).max(128_000).optional(),
  userInstruction: z.string().trim().max(4000).optional().default(''),
  sourceText: z.string().max(200_000).optional(),
  /** Where accepted output should be written, once a human approves it. */
  targetType: z.string().trim().max(40).optional().default(''),
  targetId: uuid.nullable().optional(),
  /** Include canon world entries and character sheets in the prompt. */
  includeWorld: z.boolean().optional().default(true),
  includeCharacters: z.boolean().optional().default(true),
  /**
   * Makes submission idempotent: resubmitting the same key returns the existing
   * job instead of paying for a second run. May also be sent as the
   * `Idempotency-Key` header, which takes precedence.
   */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
})

export const aiProviderSchema = z.object({
  kind: z.enum(['ANTHROPIC', 'IMAGE_GENERIC', 'VIDEO_GENERIC', 'TTS_GENERIC']),
  label: z.string().trim().min(1).max(60),
  defaultModel: z.string().trim().max(80).optional().default(''),
  /** Plaintext only on the way in; stored encrypted, never returned. */
  apiKey: z.string().trim().min(8).max(300).optional(),
  envVarName: z.string().trim().max(80).optional().default(''),
  baseUrl: z.union([z.literal(''), z.url()]).optional().default(''),
  enabled: z.boolean().optional().default(false),
})

/** Accepting an AI candidate into the real record. */
export const aiApplySchema = z.object({
  jobId: uuid,
  candidateIndex: z.coerce.number().int().min(0).max(2),
  /** Confirms the user saw what they are overwriting. */
  acknowledge: z.literal(true, { message: '必須確認才能套用 AI 產出' }),
})

export const taskSchema = z.object({
  projectId: uuid,
  episodeId: uuid.nullable().optional(),
  title: z.string().trim().min(1, '請輸入任務標題').max(160),
  description: z.string().trim().max(5000).optional().default(''),
  status: z.enum(['BACKLOG', 'TODO', 'DOING', 'REVIEW', 'DONE']).optional().default('BACKLOG'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional().default('NORMAL'),
  assigneeId: uuid.nullable().optional(),
  progress: z.coerce.number().int().min(0).max(100).optional().default(0),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
})

export const expenseSchema = z.object({
  projectId: uuid,
  episodeId: uuid.nullable().optional(),
  category: z
    .enum([
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
    .optional()
    .default('OTHER'),
  description: z.string().trim().min(1, '請輸入支出說明').max(300),
  /** String, not number: decimals must survive without float rounding. */
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, '金額格式不正確'),
  currency: z.string().trim().length(3, '請使用三字母幣別代碼').toUpperCase(),
  exchangeRate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, '匯率格式不正確')
    .optional()
    .default('1'),
  spentAt: z.coerce.date().optional(),
  vendor: z.string().trim().max(120).optional().default(''),
  paidById: uuid.nullable().optional(),
  receiptAssetId: uuid.nullable().optional(),
  note: z.string().trim().max(1000).optional().default(''),
})

export const worldEntrySchema = z.object({
  projectId: uuid,
  category: z
    .enum([
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
    .optional()
    .default('OTHER'),
  title: z.string().trim().min(1, '請輸入條目標題').max(120),
  summary: z.string().trim().max(500).optional().default(''),
  body: z.string().trim().max(20_000).optional().default(''),
  isCanon: z.boolean().optional().default(true),
  tags: z.array(z.string().trim().max(40)).max(20).optional().default([]),
})

/** Requires the user to retype the record's name before a destructive action. */
export function confirmNameSchema(expected: string) {
  return z.object({
    confirmName: z.literal(expected, { message: `請輸入「${expected}」以確認` }),
  })
}

/** Which currency a member reads totals in. Display preference only. */
export const displayCurrencySchema = z.object({
  currency: z.enum(CURRENCIES, { message: '不支援的幣別' }),
})

/* -------------------------------------------------------------------------- */
/* 小說 / 劇本                                                                 */
/* -------------------------------------------------------------------------- */

export const createChapterSchema = z.object({
  title: z.string().trim().max(120, '章節標題最多 120 個字').default(''),
})

/**
 * `expectedRevision` is the document revision the editor was opened on. The
 * server refuses a save based on a stale one, so the other member's writing is
 * never silently overwritten.
 */
export const saveChapterSchema = z.object({
  title: z.string().trim().max(120, '章節標題最多 120 個字').optional(),
  summary: z.string().max(2000, '章節摘要最多 2000 個字').optional(),
  content: z.string().max(200_000, '單一章節最多 200,000 個字元'),
  expectedRevision: z.number().int().nonnegative(),
})

export const snapshotVersionSchema = z.object({
  label: z.string().trim().max(120, '版本備註最多 120 個字').default(''),
})

/** Which editor modules are enabled for one surface. */
export const editorModulesSchema = z.object({
  surface: z.enum(EDITOR_SURFACES),
  modules: z.array(z.string()).max(64),
})

export const createSceneSchema = z.object({
  heading: z.string().trim().max(120, '場次標題最多 120 個字').default(''),
})

export const saveSceneSchema = z.object({
  heading: z.string().trim().max(120, '場次標題最多 120 個字').optional(),
  location: z.string().trim().max(120, '場景最多 120 個字').optional(),
  timeOfDay: z.string().trim().max(40, '時間最多 40 個字').optional(),
  content: z.string().max(200_000, '單一場次最多 200,000 個字元'),
  expectedRevision: z.number().int().nonnegative(),
})

/* -------------------------------------------------------------------------- */
/* 世界觀                                                                      */
/* -------------------------------------------------------------------------- */

export const createWorldEntrySchema = z.object({
  category: z.enum(WORLD_CATEGORIES),
  title: z.string().trim().min(1, '請輸入標題').max(120, '標題最多 120 個字'),
  summary: z.string().trim().max(500, '摘要最多 500 個字').optional(),
  body: z.string().max(50_000, '內文最多 50,000 個字元').optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
})

export const updateWorldEntrySchema = z.object({
  category: z.enum(WORLD_CATEGORIES).optional(),
  title: z.string().trim().min(1, '請輸入標題').max(120, '標題最多 120 個字').optional(),
  summary: z.string().trim().max(500, '摘要最多 500 個字').optional(),
  body: z.string().max(50_000, '內文最多 50,000 個字元').optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  isCanon: z.boolean().optional(),
})

export const createWorldEventSchema = z.object({
  scope: z.enum(WORLD_EVENT_SCOPES),
  title: z.string().trim().min(1, '請輸入事件名稱').max(120, '名稱最多 120 個字'),
  description: z.string().trim().max(2000, '說明最多 2000 個字').optional(),
  eraLabel: z.string().trim().max(60, '紀年最多 60 個字').optional(),
  revealedInEpisode: z.number().int().positive().nullable().optional(),
})

/* -------------------------------------------------------------------------- */
/* 角色                                                                        */
/* -------------------------------------------------------------------------- */

export const createCharacterSchema = z.object({
  name: z.string().trim().min(1, '請輸入角色名稱').max(60, '名稱最多 60 個字'),
  alias: z.string().trim().max(120, '別名最多 120 個字').optional(),
  tier: z.enum(CHARACTER_TIERS),
})

/** Only the fields a member may edit; ids and timestamps are not among them. */
export const updateCharacterSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  alias: z.string().trim().max(120).optional(),
  tier: z.enum(CHARACTER_TIERS).optional(),
  age: z.string().trim().max(60).optional(),
  gender: z.string().trim().max(30).optional(),
  appearance: z.string().max(5000).optional(),
  personality: z.string().max(5000).optional(),
  background: z.string().max(20_000).optional(),
  growth: z.string().max(20_000).optional(),
  visualPrompt: z.string().max(5000).optional(),
  negativePrompt: z.string().max(5000).optional(),
  voiceProvider: z.string().trim().max(60).optional(),
  voiceId: z.string().trim().max(120).optional(),
  voiceStyle: z.string().trim().max(120).optional(),
  voiceNote: z.string().max(2000).optional(),
})

export const createRelationshipSchema = z.object({
  fromCharacterId: uuid,
  toCharacterId: uuid,
  kind: z.string().trim().min(1, '請輸入關係').max(40, '關係最多 40 個字'),
  description: z.string().trim().max(500).optional(),
  sentiment: z.number().int().min(-100).max(100).optional(),
})
