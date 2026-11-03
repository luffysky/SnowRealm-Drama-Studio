import { z } from 'zod'
import { CURRENCIES } from '@/lib/money'
import {
  ASSET_KINDS,
  CAMERA_MOVES,
  CHARACTER_TIERS,
  DOCUMENT_KINDS,
  EPISODE_STATUSES,
  MAX_UPLOAD_BYTES,
  SHOT_SIZES,
  SHOT_STATUSES,
  STAGE_STATES,
  STAGES,
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
  stage: z.enum(STAGES).optional(),
  stageState: z.enum(STAGE_STATES).optional(),
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
  stage: z.enum(STAGES),
  state: z.enum(STAGE_STATES),
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
