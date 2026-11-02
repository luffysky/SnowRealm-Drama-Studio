import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { episodes, projects } from './catalog'
import { approvalStateEnum, documentKindEnum, reviewStateEnum, versionTargetEnum } from './enums'

/** One novel and one script per episode. */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    /** Plain text / markdown body. Chapters and scenes index into it. */
    content: text('content').notNull().default(''),
    charCount: integer('char_count').notNull().default(0),
    /** Current version number; each save appends a `versions` snapshot. */
    version: integer('version').notNull().default(1),
    /** The version marked 定稿. Null until a human approves one. */
    approvedVersionId: uuid('approved_version_id'),
    lastEditorId: uuid('last_editor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Optimistic-lock token; a stale value means the other member saved first. */
    lockRevision: integer('lock_revision').notNull().default(1),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('documents_episode_kind_key').on(t.episodeId, t.kind),
    index('documents_episode_idx').on(t.episodeId),
  ]
)

/** 章節 (novel) — ordered sections with stable ids so reordering is safe. */
export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    title: text('title').notNull().default(''),
    summary: text('summary').notNull().default(''),
    content: text('content').notNull().default(''),
    charCount: integer('char_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chapters_document_order_idx').on(t.documentId, t.sortOrder)]
)

/** 場次 (script) — a scene heading plus its body; shots reference these. */
export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    /** Scene label, e.g. S03. */
    code: text('code').notNull().default(''),
    heading: text('heading').notNull().default(''),
    location: text('location').notNull().default(''),
    timeOfDay: text('time_of_day').notNull().default(''),
    content: text('content').notNull().default(''),
    /** Runtime estimate including action and pauses, not dialogue alone. */
    estimatedSec: integer('estimated_sec').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('scenes_document_order_idx').on(t.documentId, t.sortOrder)]
)

/**
 * Immutable snapshots. Restoring never rewrites history — it appends a new
 * version whose content equals the old one (spec 08 / 51).
 */
export const versions = pgTable(
  'versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: versionTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    version: integer('version').notNull(),
    /** The branch this snapshot belongs to; null means the trunk. */
    branchId: uuid('branch_id'),
    /** Immediate ancestor, so history forms a tree rather than a flat list. */
    parentVersionId: uuid('parent_version_id'),
    /** Snapshot payload; shape depends on targetType. */
    snapshot: jsonb('snapshot').notNull(),
    charCount: integer('char_count').notNull().default(0),
    /** Short note, e.g. 「AI 續寫採用」or「還原自 v3」. */
    label: text('label').notNull().default(''),
    /** Set when this snapshot was produced by restoring an earlier one. */
    restoredFromVersionId: uuid('restored_from_version_id'),
    /** Set when an AI job produced this content, for provenance. */
    aiJobId: uuid('ai_job_id'),
    isApproved: boolean('is_approved').notNull().default(false),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('versions_target_version_key').on(t.targetType, t.targetId, t.version),
    index('versions_target_idx').on(t.targetType, t.targetId),
    index('versions_branch_idx').on(t.branchId),
    index('versions_parent_idx').on(t.parentVersionId),
  ]
)

/**
 * A named line of version history (spec v2 §5 `version_branches`, page 08「分支」).
 *
 * Lets one member try an alternative draft of an episode without disturbing the
 * version the other is working from. Merging is deliberately not automatic:
 * `mergedIntoVersionId` records that a human copied the branch head forward.
 */
export const versionBranches = pgTable(
  'version_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: versionTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** The version this branch forked from. */
    baseVersionId: uuid('base_version_id'),
    /** Newest snapshot on the branch. */
    headVersionId: uuid('head_version_id'),
    /** Exactly one branch per target is the trunk. */
    isTrunk: boolean('is_trunk').notNull().default(false),
    /** Set when a human brought this branch's content back to the trunk. */
    mergedIntoVersionId: uuid('merged_into_version_id'),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('version_branches_target_name_key').on(t.targetType, t.targetId, t.name),
    index('version_branches_target_idx').on(t.targetType, t.targetId),
  ]
)

/**
 * 定稿審核紀錄 (spec v2 §5 `approval_records`, §6.5).
 *
 * Approving pins an exact version and locks the content. Editing afterwards
 * requires an explicit unlock — recorded here as a new row rather than by
 * mutating the approval, so the history of who locked and who reopened it
 * survives. Nothing deletes a record.
 */
export const approvalRecords = pgTable(
  'approval_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    targetType: versionTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** The exact snapshot being approved. */
    versionId: uuid('version_id').references(() => versions.id, { onDelete: 'set null' }),
    state: approvalStateEnum('state').notNull().default('PENDING'),
    /** Whether this record currently locks the target against edits. */
    locks: boolean('locks').notNull().default(false),
    note: text('note').notNull().default(''),
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Set on an UNLOCKED row: why the lock was lifted. */
    unlockReason: text('unlock_reason').notNull().default(''),
    /** The approval this row supersedes, for an unlock or a re-approval. */
    supersedesId: uuid('supersedes_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('approval_records_target_idx').on(t.targetType, t.targetId, t.createdAt),
    index('approval_records_state_idx').on(t.state),
    index('approval_records_project_idx').on(t.projectId),
  ]
)

/** 審稿留言 — anchored review threads on a document. */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => versions.id, { onDelete: 'set null' }),
    state: reviewStateEnum('state').notNull().default('OPEN'),
    /** Character offsets into the reviewed content; null for a whole-document note. */
    anchorStart: integer('anchor_start'),
    anchorEnd: integer('anchor_end'),
    /** The text the comment was anchored to, kept so the note survives edits. */
    anchorText: text('anchor_text').notNull().default(''),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reviews_document_idx').on(t.documentId),
    index('reviews_state_idx').on(t.state),
  ]
)

export const documentsRelations = relations(documents, ({ one, many }) => ({
  episode: one(episodes, { fields: [documents.episodeId], references: [episodes.id] }),
  lastEditor: one(users, { fields: [documents.lastEditorId], references: [users.id] }),
  chapters: many(chapters),
  scenes: many(scenes),
  reviews: many(reviews),
}))

export const chaptersRelations = relations(chapters, ({ one }) => ({
  document: one(documents, { fields: [chapters.documentId], references: [documents.id] }),
}))

export const scenesRelations = relations(scenes, ({ one }) => ({
  document: one(documents, { fields: [scenes.documentId], references: [documents.id] }),
}))

export const reviewsRelations = relations(reviews, ({ one }) => ({
  document: one(documents, { fields: [reviews.documentId], references: [documents.id] }),
  author: one(users, { fields: [reviews.authorId], references: [users.id] }),
}))

export const versionBranchesRelations = relations(versionBranches, ({ one }) => ({
  createdBy: one(users, { fields: [versionBranches.createdById], references: [users.id] }),
}))

export const approvalRecordsRelations = relations(approvalRecords, ({ one }) => ({
  project: one(projects, { fields: [approvalRecords.projectId], references: [projects.id] }),
  version: one(versions, { fields: [approvalRecords.versionId], references: [versions.id] }),
  decidedBy: one(users, { fields: [approvalRecords.decidedById], references: [users.id] }),
}))
