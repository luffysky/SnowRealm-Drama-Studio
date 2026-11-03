import { relations } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { projects } from './catalog'
import { exportKindEnum, exportStatusEnum, notificationKindEnum } from './enums'

/**
 * Audit trail. Every mutating API route appends one row, which is what the
 * dashboard's 雙人動態 feed and the task 操作日誌 read. Rows are never updated.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Denormalised so the feed still reads correctly if a user row changes. */
    userName: text('user_name').notNull().default(''),
    /** e.g. 'create' | 'update' | 'delete' | 'upload' | 'ai.apply' | 'login' */
    action: text('action').notNull(),
    /** e.g. 'episode' | 'document' | 'shot' | 'asset' | 'task' */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /** Human-readable one-liner shown in the feed. */
    summary: text('summary').notNull().default(''),
    /** Changed fields, for the detailed log view. */
    changes: jsonb('changes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activities_created_idx').on(t.createdAt),
    index('activities_project_idx').on(t.projectId, t.createdAt),
    index('activities_entity_idx').on(t.entityType, t.entityId),
  ]
)

/**
 * Installation-wide settings, as one row per key.
 *
 * A key/value table rather than a one-row table with a column per setting:
 * settings arrive one at a time over the life of the project, and a new key
 * should not need a migration. Values are JSON so a setting can be a scalar or
 * a small object (the FX rates are an object).
 *
 * Known keys:
 *   `fx.rates` — { base, rates, asOf, source }, see src/lib/money.ts
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A requested export (novel / script / storyboard / cost report). */
export const exports = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: exportKindEnum('kind').notNull(),
    status: exportStatusEnum('status').notNull().default('QUEUED'),
    /** Format and range: `{ format: 'md', episodeFrom: 1, episodeTo: 12 }`. */
    options: jsonb('options').notNull(),
    /** Generated file in R2, once finished. */
    assetId: uuid('asset_id'),
    errorMessage: text('error_message').notNull().default(''),
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('exports_project_idx').on(t.projectId, t.createdAt)]
)

export const activitiesRelations = relations(activities, ({ one }) => ({
  user: one(users, { fields: [activities.userId], references: [users.id] }),
  project: one(projects, { fields: [activities.projectId], references: [projects.id] }),
}))

export const exportsRelations = relations(exports, ({ one }) => ({
  project: one(projects, { fields: [exports.projectId], references: [projects.id] }),
  requestedBy: one(users, { fields: [exports.requestedById], references: [users.id] }),
}))

/**
 * In-app notifications (spec v2 §5 `notifications`).
 *
 * Deliberately in-app only: §10 forbids unauthorised external delivery, so
 * nothing here emails or posts anywhere. A row is per-recipient, because the
 * two members read and dismiss independently.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** In-app destination, e.g. `/projects/<id>/episodes/<id>/novel`. */
    href: text('href').notNull().default(''),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** The record that triggered it, for deduplication. */
    entityType: text('entity_type').notNull().default(''),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_unread_idx').on(t.userId, t.readAt, t.createdAt),
    index('notifications_entity_idx').on(t.entityType, t.entityId),
  ]
)

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  project: one(projects, { fields: [notifications.projectId], references: [projects.id] }),
}))
