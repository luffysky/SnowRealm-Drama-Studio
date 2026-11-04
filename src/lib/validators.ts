import { z } from 'zod'
import { MESSAGE_KINDS } from '@/lib/chat-view'
import { EDITOR_SURFACES } from '@/lib/editor/modules'
import { AI_EFFORTS } from '@/lib/settings-view'
import { CURRENCIES } from '@/lib/money'
import { PRODUCTION_STAGE_KEYS, PRODUCTION_STAGE_STATUSES } from '@/lib/production'
import {
  ASSET_KINDS,
  CAMERA_MOVES,
  CHARACTER_TIERS,
  DOCUMENT_KINDS,
  EPISODE_STATUSES,
  MAX_UPLOAD_BYTES,
  PROJECT_STATUSES,
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
  targetChars: z.coerce.number().int().min(100).max(100000).optional().default(4000),
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

/**
 * 分集大綱.
 *
 * Every field optional, but an empty edit is rejected: it would bump
 * `updated_at` and write an activity entry for nothing.
 *
 * Empty strings are allowed and meaningful — that is how a line is cleared.
 */
export const outlineEditSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    logline: z.string().trim().max(300).optional(),
    synopsis: z.string().trim().max(5000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '沒有要變更的欄位' })

/**
 * 音樂素材的資訊 (design 84).
 *
 * `bpm` is nullable rather than defaulting to 0: an unknown tempo is not zero,
 * and storing zero would put a wrong number into a filter instead of leaving
 * it out of one.
 */
export const musicUpdateSchema = z.object({
  title: z.string().trim().min(1, '請輸入曲名').max(120),
  category: z.enum(['OP', 'ED', 'BGM', 'INSERT', 'CHARACTER_SONG', 'OTHER']),
  genreTags: z.array(z.string().trim().max(24)).max(12).optional().default([]),
  moodTags: z.array(z.string().trim().max(24)).max(12).optional().default([]),
  language: z.string().trim().max(40).optional().default(''),
  artist: z.string().trim().max(120).optional().default(''),
  bpm: z.coerce.number().int().min(20).max(400).nullable().optional().default(null),
  musicalKey: z.string().trim().max(20).optional().default(''),
  sourcePlatform: z.string().trim().max(80).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  /** Read from the file in the browser; the upload pipeline does not decode. */
  durationSec: z.coerce.number().min(0).max(86_400).nullable().optional().default(null),
})

/** 新增時還要帶已上傳完成的 asset id。 */
export const musicSchema = musicUpdateSchema.extend({
  assetId: uuid,
})

/** 集數成片：指定哪一個 asset 是成片，null 代表移除。 */
export const finalCutSchema = z.object({
  assetId: uuid.nullable(),
})

/** 一次採用多集的大綱。 */
export const outlineApplySchema = z.object({
  entries: z
    .array(
      z.object({
        episodeId: uuid,
        title: z.string().trim().max(120).optional(),
        logline: z.string().trim().max(300).optional(),
        synopsis: z.string().trim().max(5000).optional(),
      })
    )
    .min(1)
    .max(200),
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
/**
 * 新增作品.
 *
 * Only the title is required. Everything descriptive is optional and defaults
 * to empty — a new work legitimately has nothing written yet, and the
 * alternative is placeholder prose nobody asked for (spec v3 §0).
 */
export const projectCreateSchema = z
  .object({
    title: z.string().trim().min(1, '請輸入作品名稱').max(120),
    novelTitle: z.string().trim().max(120).optional().default(''),
    dramaTitle: z.string().trim().max(120).optional().default(''),
    logline: z.string().trim().max(400).optional().default(''),
    synopsis: z.string().trim().max(8000).optional().default(''),
    tags: z.array(z.string().trim().min(1).max(20)).max(8).optional().default([]),
    status: z.enum(PROJECT_STATUSES).optional().default('PLANNING'),
    targetMinSec: z.coerce.number().int().min(10).max(3600).optional().default(120),
    targetMaxSec: z.coerce.number().int().min(10).max(3600).optional().default(180),
    targetChars: z.coerce.number().int().min(100).max(100000).optional().default(4000),
    arcIndex: z.coerce.number().int().min(1).max(99).optional().default(1),
    arcTitle: z.string().trim().max(80).optional().default(''),
    /** 0 lays out no episodes; they can be added later. */
    plannedEpisodes: z.coerce.number().int().min(0).max(999).optional().default(120),
  })
  .refine((value) => value.targetMinSec <= value.targetMaxSec, {
    message: '片長下限不可大於上限',
    path: ['targetMinSec'],
  })

export const projectUpdateSchema = z
  .object({
    title: z.string().trim().min(1, '作品名稱不能空白').max(120).optional(),
    novelTitle: z.string().trim().max(120).optional(),
    dramaTitle: z.string().trim().max(120).optional(),
    logline: z.string().trim().max(400).optional(),
    synopsis: z.string().trim().max(8000).optional(),
    tags: z.array(z.string().trim().min(1).max(20)).max(8).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    targetChars: z.coerce.number().int().min(100).max(100000).optional(),
    targetMinSec: z.coerce.number().int().min(10).max(3600).optional(),
    targetMaxSec: z.coerce.number().int().min(10).max(3600).optional(),
    /**
     * Push a changed 片長 down onto the episodes that never had one set.
     *
     * `episodes.target_sec` is written **once**, when the project is created,
     * as the midpoint of the range — and nothing has ever updated it since.
     * So changing the range in 作品設定 moved a number that 體檢 and 劇本進度
     * do not read, and 120 episodes quietly kept the old target.
     */
    applyTargetToEpisodes: z.boolean().optional(),
    /** null clears the cover. */
    coverAssetId: uuid.nullable().optional(),
    /** null clears it, which means 「沿用作品封面」. */
    novelCoverAssetId: uuid.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '沒有要變更的欄位' })
  .refine(
    (value) =>
      value.targetMinSec === undefined ||
      value.targetMaxSec === undefined ||
      value.targetMinSec <= value.targetMaxSec,
    { message: '片長下限不可大於上限', path: ['targetMinSec'] }
  )

/** Step 1 of an upload: ask the server for a presigned destination. */
export const uploadRequestSchema = z.object({
  projectId: uuid,
  episodeId: uuid.nullable().optional(),
  kind: z.enum(ASSET_KINDS),
  /**
   * 對話的附件 vs 素材庫的素材 (Z116)。
   *
   * 預設 LIBRARY，所以忘了帶的上傳會進素材庫——那是比較安全的方向：
   * 一筆該在庫裡卻沒進去的素材，比一筆不該在庫裡卻混進去的更容易發現。
   */
  origin: z.enum(['LIBRARY', 'CHAT']).optional().default('LIBRARY'),
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

/**
 * Step 1 of a derived-file upload.
 *
 * Covers both axes of 「衍生檔案」: an image/poster preview and a waveform
 * peaks file. The server decides which kinds an asset may have.
 */
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
  /** 依這一集的小說生成（Z113）。正文由伺服器讀，不經過瀏覽器。 */
  novelEpisodeId: uuid.nullish(),
  /*
   * Listed rather than derived from AI_JOB_KINDS: not every job kind is
   * something a client may ask for directly, and a new kind should have to be
   * opted in here deliberately.
   */
  task: z.enum([
    'PROJECT_PLAN',
    'OUTLINE_GENERATE',
    'OUTLINE_REVIEW',
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
  /*
   * These two were missing, and zod strips unknown keys silently — so a PATCH
   * carrying a portrait was accepted, answered 200, and wrote nothing. The
   * screen said 「定妝照已更新」 and the column stayed null.
   *
   * null clears the field; `updateCharacter` checks that a non-null id is an
   * image belonging to this project and finished uploading.
   */
  keyVisualAssetId: uuid.nullable().optional(),
  voiceSampleAssetId: uuid.nullable().optional(),
})

export const createRelationshipSchema = z.object({
  fromCharacterId: uuid,
  toCharacterId: uuid,
  kind: z.string().trim().min(1, '請輸入關係').max(40, '關係最多 40 個字'),
  description: z.string().trim().max(500).optional(),
  sentiment: z.number().int().min(-100).max(100).optional(),
})

/* -------------------------------------------------------------------------- */
/* 即時對話 (Z99)                                                               */
/* -------------------------------------------------------------------------- */

export const chatSendSchema = z
  .object({
    conversationId: uuid.optional(),
    kind: z.enum(MESSAGE_KINDS).optional().default('TEXT'),
    body: z.string().max(8000).optional().default(''),
    assetId: uuid.nullable().optional(),
    durationSec: z.coerce.number().int().min(0).max(36_000).nullable().optional(),
    replyToId: uuid.nullable().optional(),
  })
  .refine((value) => value.kind !== 'TEXT' || value.body.trim().length > 0, {
    message: '訊息不能是空的',
    path: ['body'],
  })

export const chatEditSchema = z.object({
  body: z.string().trim().min(1, '訊息不能是空的').max(8000),
})

export const chatReadSchema = z.object({
  conversationId: uuid.optional(),
  seq: z.coerce.number().int().min(0),
})

export const chatPresenceSchema = z.object({
  conversationId: uuid.optional(),
  typing: z.boolean().optional().default(false),
})

export const callStartSchema = z.object({
  conversationId: uuid.optional(),
  video: z.boolean().optional().default(false),
})

export const callSignalSchema = z.object({
  callId: uuid,
  kind: z.enum(['offer', 'answer', 'ice']),
  /** Opaque SDP or ICE JSON; the server never parses it. */
  payload: z.string().max(60_000),
})

export const callStateSchema = z.object({
  state: z.enum(['ACTIVE', 'ENDED', 'DECLINED', 'MISSED']),
})

/**
 * 個人資料 (Z85).
 *
 * Every field optional, but an empty edit is rejected — it would bump
 * `updated_at` and write an activity line for nothing.
 *
 * `account` may be an empty string on purpose: that means 「只用 Email
 * 登入」, and the unique index is partial so two blank handles do not collide.
 */
export const profileUpdateSchema = z
  .object({
    /** Omitted means yourself. Anyone else needs `member.manage`. */
    userId: uuid.optional(),
    name: z.string().trim().min(1, '名字不能空白').max(60).optional(),
    email: z.string().trim().email('Email 格式不正確').max(160).optional(),
    account: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9._-]*$/, '帳號只能用英數字與 . _ -')
      .optional(),
    title: z.string().trim().max(60).optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, '顏色要是 #RRGGBB')
      .optional(),
    displayCurrency: z.enum(CURRENCIES).optional(),
  })
  .refine(
    (value) => Object.keys(value).filter((key) => key !== 'userId').length > 0,
    { message: '沒有要變更的欄位' }
  )

/* -------------------------------------------------------------------------- */
/* AI 助理 (Z100)                                                              */
/* -------------------------------------------------------------------------- */

export const assistantRunSchema = z.object({
  /** The message to answer. Must be in the thread named by the route. */
  messageId: uuid,
})

export const assistantThreadCreateSchema = z.object({
  title: z.string().trim().max(60, '標題最多 60 字').optional(),
})

export const assistantThreadPatchSchema = z.object({
  title: z.string().trim().min(1, '標題不能空白').max(60, '標題最多 60 字'),
})

export const proposalDecisionSchema = z.object({
  decision: z.enum(['apply', 'reject']),
  /**
   * Applies even though the target changed after the proposal was written.
   * Deliberately explicit: the default refuses, because the assistant never
   * saw whatever was written since.
   */
  force: z.boolean().optional().default(false),
})

/* -------------------------------------------------------------------------- */
/* 系統設定 (Z87)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Shape only. The semantic rules — a rate cannot be negative, a model needs a
 * price for every field — live in `lib/settings.ts`, because they are the same
 * rules whether a value arrives from this form, a migration or a script.
 * Checking shape here is what turns a malformed body into a 400 instead of a
 * 500 from the layer below.
 */
const positive = z.number().finite().nonnegative()

export const fxRatesSchema = z.object({
  base: z.enum(CURRENCIES),
  rates: z.record(z.enum(CURRENCIES), z.number().finite().positive()),
  asOf: z.string().trim().min(1, '要填日期'),
  source: z.string().trim().max(200).default(''),
})

export const storageCostSchema = z.object({
  usdPerGbMonth: positive,
  freeTierGb: positive,
  asOf: z.string().trim().min(1, '要填日期'),
  source: z.string().trim().max(200).default(''),
})

export const modelPricingSchema = z.object({
  pricing: z.record(
    z.string().trim().min(1),
    z.object({ input: positive, output: positive, cacheRead: positive })
  ),
})

export const taskProfilesSchema = z.object({
  profiles: z.record(
    z.string().trim().min(1),
    z.object({
      effort: z.enum(AI_EFFORTS),
      model: z.string().trim().max(120).optional(),
    })
  ),
})

export const iceServersSchema = z.object({
  servers: z
    .array(
      z.object({
        urls: z.array(z.string().trim().min(1)).min(1, '至少要有一個網址'),
        username: z.string().trim().max(200).optional(),
        credential: z.string().trim().max(400).optional(),
      })
    )
    .min(1, '至少要有一台伺服器'),
})

/**
 * 用 AI 產出覆蓋一整章 (Z122)。
 *
 * `expectedRevision` 不是選填：覆蓋別人正在打的那一章，跟覆蓋他的段落
 * 是同一類意外，所以跟存檔走同一套樂觀鎖。
 */
export const replaceChapterSchema = z.object({
  content: z.string().max(200_000, '內容太長'),
  expectedRevision: z.coerce.number().int().min(0),
  label: z.string().trim().min(1).max(120),
  aiJobId: uuid.nullish(),
})

/**
 * 批次生成 (Z127-3).
 *
 * The range is validated here rather than clamped, deliberately: a batch is
 * the one request in this app that can spend real money per episode, and
 * silently narrowing somebody's range is how 「我明明選了 EP006–EP020」
 * becomes a support question. `MAX_BATCH` still caps what gets queued — this
 * only refuses nonsense.
 */
export const aiBatchSchema = z.object({
  projectId: uuid,
  task: z.enum([
    'OUTLINE_GENERATE',
    'NOVEL_TO_SCRIPT',
    'SCRIPT_ANALYZE',
    'STORYBOARD_GENERATE',
    'NOVEL_REVIEW',
  ]),
  from: z.coerce.number().int().min(1).max(9999),
  to: z.coerce.number().int().min(1).max(9999),
  model: z.string().trim().max(80).optional(),
  providerId: uuid.nullable().optional(),
  userInstruction: z.string().trim().max(4000).optional().default(''),
})

/* -------------------------------------------------------------------------- */
/* 卷 (Z128)                                                                   */
/* -------------------------------------------------------------------------- */

export const createArcSchema = z.object({
  title: z.string().trim().min(1, '請輸入卷名').max(120, '卷名最多 120 個字'),
  logline: z.string().trim().max(500, '一句話簡介最多 500 個字').optional().default(''),
})

/**
 * Every field optional, because the dialog sends only what changed — and
 * `episodeIds` rides along so renaming a 卷 and refiling episodes into it is
 * one request rather than two that can half-fail.
 */
export const updateArcSchema = z.object({
  title: z.string().trim().max(120, '卷名最多 120 個字').optional(),
  logline: z.string().trim().max(500, '一句話簡介最多 500 個字').optional(),
  /** Counted toward the project's 規劃集數, which sums across every 卷. */
  plannedEpisodes: z.coerce.number().int().min(0).max(9999).optional(),
  episodeIds: z.array(uuid).max(500, '一次最多搬 500 集').optional(),
})

/**
 * 歌詞 (Z125).
 *
 * Stored as written — LRC or plain text, decided by `parseLyrics` on the way
 * out rather than by a format field here. A field would let the two disagree,
 * and the text itself is unambiguous: a line beginning `[mm:ss.xx]` is LRC.
 *
 * The cap is generous because a timed sheet carries a tag on every line, so
 * the markup is a real fraction of the file.
 */
export const lyricsSchema = z.object({
  lyrics: z.string().max(100_000, '歌詞太長了'),
})

/**
 * 用聽的幫歌詞標時間 (Z131).
 *
 * The lyrics travel with the request rather than being read from the database:
 * the editor aligns what is **on screen**, which may be text pasted seconds
 * ago and not saved yet. Aligning the saved copy would silently time the wrong
 * words.
 */
export const lyricsAlignSchema = z.object({
  lyrics: z.string().min(1, '先貼上歌詞').max(100_000, '歌詞太長了'),
})

/**
 * 有聲書 (Z129).
 *
 * The voice is validated against the live list in the route rather than here:
 * which voices exist is Azure's answer and it differs by region, so a list
 * written down in this file would be wrong the day it changed.
 */
export const audiobookSchema = z.object({
  narratorVoice: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(20).optional(),
})

/**
 * 把正文裡認出來的說話人建成角色 (Z137).
 *
 * Names rather than ids, because these people have no row yet — the name as
 * the prose wrote it is the only handle they have.
 */
export const promoteSpeakersSchema = z.object({
  names: z.array(z.string().trim().min(1).max(60)).min(1, '至少要選一個').max(50),
})
