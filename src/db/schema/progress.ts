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
import { stageEnum, stageStateEnum, taskPriorityEnum, taskStatusEnum } from './enums'

/**
 * Nine production stages per episode. These rows are what the 120-episode grid
 * and the progress page read; they are created with the episode.
 */
export const episodeStages = pgTable(
  'episode_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    stage: stageEnum('stage').notNull(),
    state: stageStateEnum('state').notNull().default('TODO'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('episode_stages_episode_stage_key').on(t.episodeId, t.stage),
    index('episode_stages_episode_idx').on(t.episodeId),
    index('episode_stages_assignee_idx').on(t.assigneeId, t.state),
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

export const episodeStagesRelations = relations(episodeStages, ({ one }) => ({
  episode: one(episodes, { fields: [episodeStages.episodeId], references: [episodes.id] }),
  assignee: one(users, { fields: [episodeStages.assigneeId], references: [users.id] }),
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
