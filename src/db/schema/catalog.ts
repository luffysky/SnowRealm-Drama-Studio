import { relations } from 'drizzle-orm'
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { episodeStatusEnum, projectStatusEnum } from './enums'

/**
 * 作品 → 篇章 → 集數 are three distinct levels (spec 21「作品、篇章、集數須分層」).
 * The live project is 《一灶見山河》; its first arc is 《萬家燈火》, 120 episodes.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    genre: text('genre').notNull().default(''),
    status: projectStatusEnum('status').notNull().default('PLANNING'),
    coverAssetId: uuid('cover_asset_id'),
    /** Default target duration for new episodes, in seconds. */
    targetMinSec: integer('target_min_sec').notNull().default(120),
    targetMaxSec: integer('target_max_sec').notNull().default(180),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('projects_status_idx').on(t.status)]
)

/** 篇章 / 部 — e.g. 第一部《萬家燈火》. */
export const arcs = pgTable(
  'arcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 第幾部, 1-based. */
    index: integer('index').notNull(),
    title: text('title').notNull(),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    plannedEpisodes: integer('planned_episodes').notNull().default(120),
    coverAssetId: uuid('cover_asset_id'),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('arcs_project_index_key').on(t.projectId, t.index),
    index('arcs_project_idx').on(t.projectId),
  ]
)

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    arcId: uuid('arc_id')
      .notNull()
      .references(() => arcs.id, { onDelete: 'cascade' }),
    /** 第幾集 within the arc, 1-based (1..120). */
    number: integer('number').notNull(),
    title: text('title').notNull().default(''),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    /** Target runtime in seconds; validated against the arc's project range. */
    targetSec: integer('target_sec').notNull().default(150),
    status: episodeStatusEnum('status').notNull().default('PLANNED'),
    /** Planned air / delivery date, used by the progress gantt. */
    dueDate: timestamp('due_date', { withTimezone: true }),
    notes: text('notes').notNull().default(''),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('episodes_arc_number_key').on(t.arcId, t.number),
    index('episodes_arc_number_idx').on(t.arcId, t.number),
    index('episodes_project_idx').on(t.projectId),
    index('episodes_status_idx').on(t.status),
  ]
)

export const projectsRelations = relations(projects, ({ many }) => ({
  arcs: many(arcs),
  episodes: many(episodes),
}))

export const arcsRelations = relations(arcs, ({ one, many }) => ({
  project: one(projects, { fields: [arcs.projectId], references: [projects.id] }),
  episodes: many(episodes),
}))

export const episodesRelations = relations(episodes, ({ one }) => ({
  project: one(projects, { fields: [episodes.projectId], references: [projects.id] }),
  arc: one(arcs, { fields: [episodes.arcId], references: [arcs.id] }),
}))
