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
import { projects } from './catalog'
import { worldCategoryEnum, worldEventScopeEnum } from './enums'

/**
 * 世界觀設定 — dynasty, geography, trade routes, institutions, time-travel
 * rules, foreshadowing.
 *
 * `isCanon` marks what an AI consistency check must report against but must
 * never silently rewrite (spec v2 §0, §10「不得用AI示意圖覆蓋正式資料」).
 */
export const worldEntries = pgTable(
  'world_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    category: worldCategoryEnum('category').notNull().default('OTHER'),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    body: text('body').notNull().default(''),
    isCanon: boolean('is_canon').notNull().default(true),
    tags: text('tags').array().notNull().default([]),
    /** Related world entries, by id. */
    relatedIds: uuid('related_ids').array().notNull().default([]),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('world_entries_project_title_key').on(t.projectId, t.title),
    index('world_entries_project_category_idx').on(t.projectId, t.category),
  ]
)

/**
 * 世界正史時間線 (spec v2 §5 `world_events`).
 *
 * Separate from `world_entries` because an entry is a *standing fact* ("the
 * dynasty's currency is X") while an event is a *point on the timeline* that
 * the story reveals in a particular episode. 《一灶見山河》needs both: the
 * previous life, the crossing, the amnesia and the plum-blossom mark are
 * ordered events, not settings.
 *
 * `inUniverseOrder` is a sortable integer rather than a date because the
 * in-world calendar is not fixed; `eraLabel` carries the human-readable form.
 */
export const worldEvents = pgTable(
  'world_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    scope: worldEventScopeEnum('scope').notNull().default('MAIN_TIMELINE'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Human-readable in-world time, e.g. 「永昌三年冬」. */
    eraLabel: text('era_label').notNull().default(''),
    /** Chronological position in the story's own timeline. */
    inUniverseOrder: integer('in_universe_order').notNull().default(0),
    /** The episode in which this event is revealed to the audience. */
    revealedInEpisode: integer('revealed_in_episode'),
    /** World entries this event depends on or changes. */
    relatedEntryIds: uuid('related_entry_ids').array().notNull().default([]),
    /** Characters involved. */
    characterIds: uuid('character_ids').array().notNull().default([]),
    isCanon: boolean('is_canon').notNull().default(true),
    /** Set when the event is a planted setup; names what pays it off. */
    payoffEventId: uuid('payoff_event_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('world_events_project_order_idx').on(t.projectId, t.inUniverseOrder),
    index('world_events_reveal_idx').on(t.projectId, t.revealedInEpisode),
    index('world_events_scope_idx').on(t.scope),
  ]
)

export const worldEntriesRelations = relations(worldEntries, ({ one }) => ({
  project: one(projects, { fields: [worldEntries.projectId], references: [projects.id] }),
}))

export const worldEventsRelations = relations(worldEvents, ({ one }) => ({
  project: one(projects, { fields: [worldEvents.projectId], references: [projects.id] }),
}))
