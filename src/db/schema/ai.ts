import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { episodes, projects } from './catalog'
import { aiJobKindEnum, aiJobStatusEnum, aiProviderKindEnum } from './enums'

/**
 * A configured AI backend. One row per provider the studio has set up.
 *
 * The API key is **never** stored in plaintext and never leaves the server:
 * `apiKeyCiphertext` is AES-256-GCM, decrypted only inside the adapter
 * (see src/lib/crypto.ts). The UI only ever receives `apiKeyLast4`.
 * A provider can also inherit its key from a server env var instead, in which
 * case `apiKeyCiphertext` is null and `envVarName` names the variable.
 */
export const aiProviders = pgTable(
  'ai_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: aiProviderKindEnum('kind').notNull(),
    /** Display label, e.g. 「Claude（文字）」. */
    label: text('label').notNull(),
    /** Default model id for this provider, e.g. claude-opus-5. */
    defaultModel: text('default_model').notNull().default(''),
    /** Models the UI offers for this provider. */
    availableModels: text('available_models').array().notNull().default([]),
    apiKeyCiphertext: text('api_key_ciphertext'),
    /** Last 4 characters, for the masked display. */
    apiKeyLast4: text('api_key_last4').notNull().default(''),
    /** Read the key from this server env var instead of the DB. */
    envVarName: text('env_var_name').notNull().default(''),
    /** Override for self-hosted or proxied endpoints. */
    baseUrl: text('base_url').notNull().default(''),
    enabled: boolean('enabled').notNull().default(false),
    /** Result of the last 連線測試. */
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastTestMessage: text('last_test_message').notNull().default(''),
    /** Soft monthly spend cap in base currency; null for no cap. */
    monthlyBudget: numeric('monthly_budget', { precision: 14, scale: 4 }),
    /** Max concurrently running jobs for this provider. */
    maxConcurrency: integer('max_concurrency').notNull().default(2),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_providers_kind_idx').on(t.kind)]
)

/**
 * One AI request and its outcome — and the queue row the background worker
 * claims (spec v2 §6.6).
 *
 * Jobs are **not** executed inside the HTTP request that creates them: a long
 * generation would exceed the serverless function limit. `POST /api/ai/jobs`
 * only enqueues; `/api/ai/worker` claims and runs.
 *
 * A finished job lands in `AWAITING_REVIEW`, never written into the novel,
 * script or storyboard. `applyCandidate` is the only path from AI output to
 * real data (spec v2 §0「結果先候選後人工採用」).
 */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    kind: aiJobKindEnum('kind').notNull(),
    status: aiJobStatusEnum('status').notNull().default('QUEUED'),
    providerId: uuid('provider_id').references(() => aiProviders.id, { onDelete: 'set null' }),
    model: text('model').notNull().default(''),

    /**
     * Caller-supplied key that makes enqueueing idempotent: re-submitting the
     * same request returns the existing job instead of paying for it twice
     * (spec v2 §6.6「重試不得盲目重複扣費」).
     */
    idempotencyKey: text('idempotency_key'),

    /** What the job was asked to do: prompt, parameters, referenced context ids. */
    request: jsonb('request').notNull(),
    /** Candidate outputs. An array so A/B comparison dialogs have both. */
    result: jsonb('result'),

    /** The record this job targets, so accepted output knows where to go. */
    targetType: text('target_type').notNull().default(''),
    targetId: uuid('target_id'),
    /** Set once a human accepted a candidate; names the version it created. */
    appliedVersionId: uuid('applied_version_id'),
    appliedById: uuid('applied_by_id').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),

    // --- queue bookkeeping ------------------------------------------------
    /** Higher runs first. */
    priority: integer('priority').notNull().default(0),
    /** Worker lease: set when claimed, cleared when the attempt ends. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    /** Opaque id of the worker invocation holding the lease. */
    lockedBy: text('locked_by').notNull().default(''),
    /**
     * The provider's own handle for an in-flight generation.
     *
     * Set when a media job has been submitted but not finished. Its presence
     * is what tells the worker to poll rather than submit again — paying twice
     * for the same video is the mistake this prevents.
     */
    externalJobId: text('external_job_id').notNull().default(''),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** Exponential backoff gate; the worker ignores jobs scheduled later. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by a cancel request; the worker checks it before and after the call. */
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    /** Coarse progress for the UI, 0..100. Never faked by the client. */
    progress: integer('progress').notNull().default(0),
    progressNote: text('progress_note').notNull().default(''),

    // --- accounting -------------------------------------------------------
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    /** Estimate shown before running. Kept separate from the actual (§6.7). */
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
    actualCost: numeric('actual_cost', { precision: 12, scale: 6 }),
    currency: text('currency').notNull().default('USD'),

    errorCode: text('error_code').notNull().default(''),
    errorMessage: text('error_message').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_jobs_status_idx').on(t.status, t.createdAt),
    index('ai_jobs_project_idx').on(t.projectId),
    index('ai_jobs_episode_idx').on(t.episodeId),
    index('ai_jobs_kind_idx').on(t.kind),
    index('ai_jobs_target_idx').on(t.targetType, t.targetId),
    /** The worker's claim query: ready jobs, highest priority first. */
    index('ai_jobs_claim_idx').on(t.status, t.nextAttemptAt, t.priority),
    /**
     * Partial unique index: one job per key. Rows with a null key are
     * unconstrained, so jobs that do not need idempotency are unaffected.
     */
    uniqueIndex('ai_jobs_idempotency_key_idx')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ]
)

/**
 * One row per execution attempt, so a retry is auditable and a provider charge
 * can be attributed to the attempt that incurred it rather than to the job as
 * a whole (spec v2 §5 `ai_job_attempts`).
 */
export const aiJobAttempts = pgTable(
  'ai_job_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    /** 1-based. */
    attempt: integer('attempt').notNull(),
    status: aiJobStatusEnum('status').notNull(),
    model: text('model').notNull().default(''),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    errorCode: text('error_code').notNull().default(''),
    errorMessage: text('error_message').notNull().default(''),
    /** Whether the adapter judged the failure worth retrying. */
    retryable: boolean('retryable').notNull().default(false),
    durationMs: integer('duration_ms').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('ai_job_attempts_job_idx').on(t.jobId, t.attempt)]
)

/**
 * Which provider and model serve a given task kind (spec v2 §5
 * `model_assignments`). Lets the studio route e.g. storyboard generation to a
 * cheaper model than novel continuation without touching code.
 */
export const modelAssignments = pgTable(
  'model_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    task: aiJobKindEnum('task').notNull(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => aiProviders.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    /**
     * Effort level passed to the adapter: low | medium | high | xhigh | max.
     *
     * **可為 null，而 null 有意義**（Z160）：代表這一列沒有特別指定，交給
     * `TASK_EFFORT` 與系統設定去回答。
     *
     * 本來是 `notNull().default('high')`，而 `applyAssignment` 會把它填進請
     * 求、請求又在優先序裡排第一——於是指派過一次模型的任務就永遠是 high，
     * 那張每任務的表又讀不到了。跟 Z157 是同一個 bug 換一扇門：一個預設值
     * 替人做了決定，而「人沒選」跟「人選了 high」在資料上長得一樣。
     */
    effort: text('effort'),
    /** 同上：null 代表沒指定。舊的 32000 預設值已在 0032 回填成 null。 */
    maxTokens: integer('max_tokens'),
    /** How many candidates to request by default. */
    candidates: integer('candidates').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('model_assignments_task_idx').on(t.task)]
)

export const aiProvidersRelations = relations(aiProviders, ({ many }) => ({
  jobs: many(aiJobs),
  assignments: many(modelAssignments),
}))

export const aiJobsRelations = relations(aiJobs, ({ one, many }) => ({
  project: one(projects, { fields: [aiJobs.projectId], references: [projects.id] }),
  episode: one(episodes, { fields: [aiJobs.episodeId], references: [episodes.id] }),
  provider: one(aiProviders, { fields: [aiJobs.providerId], references: [aiProviders.id] }),
  requestedBy: one(users, { fields: [aiJobs.requestedById], references: [users.id] }),
  attempts: many(aiJobAttempts),
}))

export const aiJobAttemptsRelations = relations(aiJobAttempts, ({ one }) => ({
  job: one(aiJobs, { fields: [aiJobAttempts.jobId], references: [aiJobs.id] }),
}))

export const modelAssignmentsRelations = relations(modelAssignments, ({ one }) => ({
  provider: one(aiProviders, {
    fields: [modelAssignments.providerId],
    references: [aiProviders.id],
  }),
}))

/**
 * One AI candidate as a row (spec v2 §5 `ai_outputs`).
 *
 * Candidates were previously only inside `ai_jobs.result` as JSON. They are
 * rows here so the comparison dialogs can page and filter them, so adopting one
 * records exactly which candidate was chosen, and so a provenance question
 * ("which model wrote this paragraph?") is answerable with a query.
 */
export const aiOutputs = pgTable(
  'ai_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => aiJobAttempts.id, { onDelete: 'set null' }),
    /** 0-based position; drives the 候選A / 候選B labelling. */
    index: integer('index').notNull(),
    label: text('label').notNull().default(''),
    /** The produced prose. */
    content: text('content').notNull().default(''),
    /** Parsed payload for structured tasks (storyboard rows, findings). */
    structured: jsonb('structured'),
    charCount: integer('char_count').notNull().default(0),
    model: text('model').notNull().default(''),
    /** Set when a human adopted this candidate. */
    chosenAt: timestamp('chosen_at', { withTimezone: true }),
    chosenById: uuid('chosen_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** The version snapshot this candidate produced, once adopted. */
    appliedVersionId: uuid('applied_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_outputs_job_index_key').on(t.jobId, t.index),
    index('ai_outputs_job_idx').on(t.jobId),
  ]
)

export const aiOutputsRelations = relations(aiOutputs, ({ one }) => ({
  job: one(aiJobs, { fields: [aiOutputs.jobId], references: [aiJobs.id] }),
  attempt: one(aiJobAttempts, { fields: [aiOutputs.attemptId], references: [aiJobAttempts.id] }),
  chosenBy: one(users, { fields: [aiOutputs.chosenById], references: [users.id] }),
}))

/**
 * 編劇助手存下來的整理 (Z200).
 *
 * 在這之前它跑出來的東西只活在那個分頁裡：重新整理就沒了，而每跑一次都是一次
 * 新的花費。存起來之後可以隨時點開看，也不用為了看昨天的結論再付一次錢。
 *
 * `kind` 是 **text 不是 enum**（Z184 的教訓）：pg 的 enum 加了就刪不掉，而這一
 * 欄之後很可能會多出「伏筆追蹤」「跨集連貫」之類的種類。合法值由應用程式把關。
 */
export const writerReports = pgTable(
  'writer_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 逐集的那一種才有；主線整理與問答是 null。 */
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    /** `DIGEST`（主線與人設）／`EPISODE`（逐集）／`ASK`（問答）。 */
    kind: text('kind').notNull(),
    /** 列表上顯示的那一行。存下來就不用為了畫清單去解整包 JSON。 */
    title: text('title').notNull().default(''),
    /** 整包結果，形狀依 `kind` 而定（見 `src/lib/ai/story-audit-view.ts`）。 */
    payload: jsonb('payload').notNull(),
    model: text('model').notNull().default(''),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('writer_reports_project_idx').on(t.projectId, t.createdAt)]
)

export const writerReportsRelations = relations(writerReports, ({ one }) => ({
  project: one(projects, { fields: [writerReports.projectId], references: [projects.id] }),
  episode: one(episodes, { fields: [writerReports.episodeId], references: [episodes.id] }),
  createdBy: one(users, { fields: [writerReports.createdById], references: [users.id] }),
}))
