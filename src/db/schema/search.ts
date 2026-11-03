import { relations } from 'drizzle-orm'
import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { projects } from './catalog'

/**
 * `real[]`, mapped to a plain number array.
 *
 * Drizzle has no built-in float-array type, and the embedding is not something
 * the app should be handed as a string.
 */
const realArray = customType<{ data: number[]; driverData: string | number[] }>({
  dataType() {
    return 'real[]'
  },
  fromDriver(value) {
    if (Array.isArray(value)) return value.map(Number)
    // node-postgres hands back `{1,2,3}` for an array literal.
    return String(value)
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter(Boolean)
      .map(Number)
  },
  toDriver(value) {
    return `{${value.join(',')}}`
  },
})

/**
 * The search index (`docs/SEARCH.md`).
 *
 * One row per chunk of indexable text. Everything searchable in the studio is
 * flattened into this shape — prose, settings, characters, metadata — so the
 * search box does not need to know about nine different tables, and adding a
 * tenth is an indexer change rather than a query change.
 *
 * `embedding` is `real[]` rather than pgvector's `vector`: Neon has the
 * extension but the local test cluster does not, and a schema that only
 * migrates in one environment is worse than a sequential scan over a few
 * thousand rows. See the migration for the full reasoning.
 */
export const searchDocuments = pgTable(
  'search_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** EPISODE / CHAPTER / SCENE / WORLD_ENTRY / WORLD_EVENT / CHARACTER / PROJECT */
    kind: text('kind').notNull(),
    refId: uuid('ref_id').notNull(),
    /**
     * The episode a chapter or scene belongs to.
     *
     * Without it a hit on chapter text can only link to the novel list; with
     * it the result opens the editor the text actually lives in. Null for
     * sources that are not inside an episode.
     */
    parentRefId: uuid('parent_ref_id'),
    chunkIndex: integer('chunk_index').notNull().default(0),
    title: text('title').notNull().default(''),
    /** Shown in the result list; not the whole chunk. */
    snippet: text('snippet').notNull().default(''),
    content: text('content').notNull(),
    /** 1024 dims (voyage-4). Null until a provider key exists. */
    embedding: realArray('embedding'),
    embeddingModel: text('embedding_model').notNull().default(''),
    /** Unchanged content is not re-embedded — that is the whole cost control. */
    contentHash: text('content_hash').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('search_documents_source_key').on(t.kind, t.refId, t.chunkIndex),
    index('search_documents_project_idx').on(t.projectId, t.kind),
  ]
)

export const searchDocumentsRelations = relations(searchDocuments, ({ one }) => ({
  project: one(projects, { fields: [searchDocuments.projectId], references: [projects.id] }),
}))
