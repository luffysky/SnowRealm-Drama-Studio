import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { episodes, projects } from './catalog'
import {
  assigneeTypeEnum,
  productionStageKeyEnum,
  productionStageStatusEnum,
  taskPriorityEnum,
  taskStatusEnum,
} from './enums'

/**
 * Nine production stages per episode (spec v3 §11.2).
 *
 * `projectId` is denormalised from the episode on purpose: every query in the
 * app is scoped by project, and carrying it here means the progress tables can
 * be filtered without joining through episodes — which is also what makes the
 * "all queries are limited by project_id" rule cheap enough to actually follow.
 *
 * `progressPercent` exists because a stage is not binary. The completion
 * contract is one place — `stageFraction` in `src/lib/production.ts` — so the
 * dashboard, the overview, the episode list and the progress page cannot
 * disagree about what 37% means.
 */
export const episodeProductionStages = pgTable(
  'episode_production_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    stageKey: productionStageKeyEnum('stage_key').notNull(),
    status: productionStageStatusEnum('status').notNull().default('not_started'),
    /** 0–100. Only meaningful while `status` is `in_progress`. */
    progressPercent: integer('progress_percent').notNull().default(0),
    assigneeType: assigneeTypeEnum('assignee_type'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** The version accepted when this stage was approved, if any. */
    approvedVersionId: uuid('approved_version_id'),
    note: text('note').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('episode_production_stages_episode_stage_key').on(t.episodeId, t.stageKey),
    index('episode_production_stages_project_idx').on(t.projectId, t.stageKey),
    index('episode_production_stages_episode_idx').on(t.episodeId),
    index('episode_production_stages_assignee_idx').on(t.assigneeId, t.status),
  ]
)

/**
 * Append-only audit of every stage change (spec v3 §11.2「可追溯每次變更」).
 *
 * Rows are never updated or deleted. A progress number that cannot be traced
 * back to who moved it and when is not evidence of anything.
 */
export const productionProgressEvents = pgTable(
  'production_progress_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    stageId: uuid('stage_id').references(() => episodeProductionStages.id, {
      onDelete: 'set null',
    }),
    /** Kept even if the stage row is removed, so history survives. */
    stageKey: productionStageKeyEnum('stage_key').notNull(),
    fromStatus: productionStageStatusEnum('from_status'),
    toStatus: productionStageStatusEnum('to_status').notNull(),
    fromProgress: integer('from_progress'),
    toProgress: integer('to_progress').notNull().default(0),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: assigneeTypeEnum('actor_type').notNull().default('USER'),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('production_progress_events_stage_idx').on(t.stageId, t.createdAt),
    index('production_progress_events_project_idx').on(t.projectId, t.createdAt),
  ]
)

/** A batch target — 「EP001–EP020 於 11/30 前完成分鏡」. */
export const productionMilestones = pgTable(
  'production_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Inclusive episode range this milestone covers; null for the whole project. */
    episodeFrom: integer('episode_from'),
    episodeTo: integer('episode_to'),
    /** Null means "every stage". */
    stageKey: productionStageKeyEnum('stage_key'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('production_milestones_project_idx').on(t.projectId, t.targetDate)]
)

/**
 * "This stage cannot start until that one finishes."
 *
 * Both ends are stage rows rather than stage *keys*, because the dependency is
 * between concrete pieces of work — EP007's 分鏡 may wait on EP006's 劇本.
 */
export const productionDependencies = pgTable(
  'production_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => episodeProductionStages.id, { onDelete: 'cascade' }),
    dependsOnStageId: uuid('depends_on_stage_id')
      .notNull()
      .references(() => episodeProductionStages.id, { onDelete: 'cascade' }),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('production_dependencies_pair_key').on(t.stageId, t.dependsOnStageId),
    index('production_dependencies_project_idx').on(t.projectId),
  ]
)

/** 任務看板 — five columns, assignable to either member. */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: taskStatusEnum('status').notNull().default('BACKLOG'),
    priority: taskPriorityEnum('priority').notNull().default('NORMAL'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** Position within its board column. */
    sortOrder: integer('sort_order').notNull().default(0),
    /** 0..100, shown on the card. */
    progress: integer('progress').notNull().default(0),
    startDate: timestamp('start_date', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Tasks that must finish first, for the gantt dependency lines. */
    blockedByIds: uuid('blocked_by_ids').array().notNull().default([]),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Optimistic-lock token so two simultaneous board drags cannot silently clobber. */
    lockRevision: integer('lock_revision').notNull().default(1),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tasks_project_status_idx').on(t.projectId, t.status),
    index('tasks_assignee_idx').on(t.assigneeId),
    index('tasks_episode_idx').on(t.episodeId),
    index('tasks_due_idx').on(t.dueDate),
  ]
)

export const subtasks = pgTable(
  'subtasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subtasks_task_order_idx').on(t.taskId, t.sortOrder)]
)

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull().default(''),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_comments_task_idx').on(t.taskId, t.createdAt)]
)

export const episodeProductionStagesRelations = relations(
  episodeProductionStages,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [episodeProductionStages.projectId],
      references: [projects.id],
    }),
    episode: one(episodes, {
      fields: [episodeProductionStages.episodeId],
      references: [episodes.id],
    }),
    assignee: one(users, {
      fields: [episodeProductionStages.assigneeId],
      references: [users.id],
    }),
    events: many(productionProgressEvents),
  })
)

export const productionProgressEventsRelations = relations(
  productionProgressEvents,
  ({ one }) => ({
    stage: one(episodeProductionStages, {
      fields: [productionProgressEvents.stageId],
      references: [episodeProductionStages.id],
    }),
    actor: one(users, { fields: [productionProgressEvents.actorId], references: [users.id] }),
  })
)

export const productionMilestonesRelations = relations(productionMilestones, ({ one }) => ({
  project: one(projects, { fields: [productionMilestones.projectId], references: [projects.id] }),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  episode: one(episodes, { fields: [tasks.episodeId], references: [episodes.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  subtasks: many(subtasks),
  comments: many(taskComments),
}))

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  task: one(tasks, { fields: [subtasks.taskId], references: [tasks.id] }),
}))

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [taskComments.authorId], references: [users.id] }),
}))
