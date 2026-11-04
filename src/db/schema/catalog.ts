import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
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
    /**
     * 小說與短劇可以各有書名。
     *
     * One production, two products: the novel is published under one name and
     * the short drama released under another, which is normal practice. Empty
     * means "same as `title`" rather than being backfilled with a copy —
     * a copy would silently stop following the work's name when it changed.
     * Read them through `@/lib/project-titles`, never directly.
     */
    novelTitle: text('novel_title').notNull().default(''),
    dramaTitle: text('drama_title').notNull().default(''),
    slug: text('slug').notNull().unique(),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    genre: text('genre').notNull().default(''),
    /** Genre chips shown on the card, e.g. 古風 / 愛情 / 權謀 (design 03). */
    tags: text('tags').array().notNull().default([]),
    status: projectStatusEnum('status').notNull().default('PLANNING'),
    /** 主力作品 — the one the studio is actively pushing. At most one is expected. */
    isFlagship: boolean('is_flagship').notNull().default(false),
    coverAssetId: uuid('cover_asset_id'),
    /**
     * 小說封面. Empty means "use the work's cover".
     *
     * Separate from `coverAssetId` because they are different pictures: that
     * one is the drama's key art, this one is a book cover, and the novel can
     * carry a different title from the drama (0010_project_titles). Sharing
     * one column would make either the shelf or the project list show the
     * wrong image.
     */
    novelCoverAssetId: uuid('novel_cover_asset_id'),
    /** 負責人 and 技術支援, shown in the detail rail. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    techLeadId: uuid('tech_lead_id').references(() => users.id, { onDelete: 'set null' }),
    /** 開工日期 / 預計完成. */
    startDate: timestamp('start_date', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    /** Default target duration for new episodes, in seconds. */
    targetMinSec: integer('target_min_sec').notNull().default(120),
    targetMaxSec: integer('target_max_sec').notNull().default(180),
    /**
     * 一集的目標字數 (Z98).
     *
     * Beside the two second-counts because it is the same kind of fact: the
     * rhythm of *this* work. It used to be `targetChars={4000}` written into
     * the novel page's JSX — not even a constant — so a second work with a
     * different pace could not have a different target without a deploy.
     */
    targetChars: integer('target_chars').notNull().default(4000),
    /**
     * When indexable content last changed without being re-indexed.
     *
     * Null means the index is current. It is set by content writes and cleared
     * by a reindex, so the search panel can say the index is stale instead of
     * quietly returning yesterday's results — which is indistinguishable from
     * "that text does not exist".
     *
     * Marking is deliberately all this does. The novel editor autosaves every
     * 2.5 seconds and embeddings are billed per token, so reindexing on every
     * write would charge for a sentence being typed.
     */
    searchDirtyAt: timestamp('search_dirty_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('projects_status_idx').on(t.status),
    // Partial: only projects behind their index are ever scanned.
    index('projects_search_dirty_idx')
      .on(t.searchDirtyAt)
      .where(sql`${t.searchDirtyAt} is not null`),
  ]
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
    /**
     * 第幾集, 1-based, **project-wide** (1..120).
     *
     * The unique constraint below is per arc, which once read as 「第幾集
     * within the arc」 — true only while every project had exactly one arc.
     * Now that 卷 can be created and episodes moved between them (Z128), it
     * matters that this number is the project's: 小說、劇本、分鏡 and every
     * 「第 007 集」 written in the prose refer to it, so **moving an episode
     * to another 卷 must never renumber it**. 卷 is a container, not an
     * address.
     */
    number: integer('number').notNull(),
    title: text('title').notNull().default(''),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    /** Target runtime in seconds; validated against the arc's project range. */
    targetSec: integer('target_sec').notNull().default(150),
    status: episodeStatusEnum('status').notNull().default('PLANNED'),
    /** Still frame shown in the episode cards and the 05 list. */
    coverAssetId: uuid('cover_asset_id'),
    /**
     * 成片 — the finished cut of this episode.
     *
     * Earlier cuts are not lost: a re-edit is uploaded as a new asset in the
     * same lineage (`root_asset_id` + `version`), and this column moves to
     * point at it. So switching the current cut never destroys the one that
     * shipped, and a released episode can still be traced to the exact file
     * that was released.
     *
     * No foreign key, matching every other asset reference in this schema —
     * `updateEpisodeFinalCut()` validates it instead (kind, upload status and
     * project), because the database will not.
     */
    finalAssetId: uuid('final_asset_id'),
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

/**
 * Per-member favourite (the heart on each card in design 03).
 *
 * Its own table rather than a column on `projects`, because the two members
 * favourite independently — a flag on the project would make one person's
 * choice overwrite the other's.
 */
export const projectFavourites = pgTable(
  'project_favourites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index('project_favourites_user_idx').on(t.userId),
  ]
)

export const projectsRelations = relations(projects, ({ one, many }) => ({
  arcs: many(arcs),
  episodes: many(episodes),
  owner: one(users, { fields: [projects.ownerId], references: [users.id], relationName: 'project_owner' }),
  techLead: one(users, { fields: [projects.techLeadId], references: [users.id], relationName: 'project_tech_lead' }),
  favourites: many(projectFavourites),
}))

export const projectFavouritesRelations = relations(projectFavourites, ({ one }) => ({
  user: one(users, { fields: [projectFavourites.userId], references: [users.id] }),
  project: one(projects, { fields: [projectFavourites.projectId], references: [projects.id] }),
}))

export const arcsRelations = relations(arcs, ({ one, many }) => ({
  project: one(projects, { fields: [arcs.projectId], references: [projects.id] }),
  episodes: many(episodes),
}))

export const episodesRelations = relations(episodes, ({ one }) => ({
  project: one(projects, { fields: [episodes.projectId], references: [projects.id] }),
  arc: one(arcs, { fields: [episodes.arcId], references: [arcs.id] }),
}))
