import { relations } from 'drizzle-orm'
import {
  bigint,
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
import { assetKindEnum, assetVariantKindEnum, uploadStatusEnum } from './enums'

/**
 * Metadata only. The bytes live in the private Cloudflare R2 bucket under
 * `objectKey`, which is a UUID path — never a user-supplied filename. Reads and
 * writes both go through short-lived presigned URLs minted by the server after
 * it has checked the caller's permission.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    kind: assetKindEnum('kind').notNull(),
    /** Display name; the original filename as uploaded. Never edited. */
    name: text('name').notNull(),
    /**
     * Editable display name, e.g. 《一灶見山河》主題曲.
     *
     * Empty means「用 `name`」rather than being backfilled with a copy of it:
     * a copy would stop following the filename for assets nobody has renamed,
     * and `name` is still what a download is saved as.
     */
    title: text('title').notNull().default(''),
    /** R2 object key. UUID-based, e.g. `projects/<uuid>/image/<uuid>.png`. */
    objectKey: text('object_key').notNull().unique(),
    mimeType: text('mime_type').notNull().default(''),
    /** bigint: video files exceed the 2^31 int range. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    /** Duration for audio/video, in seconds. */
    durationSec: integer('duration_sec'),
    width: integer('width'),
    height: integer('height'),
    /** Checksum used to detect duplicate uploads. */
    checksum: text('checksum').notNull().default(''),
    /**
     * Version within a logical slot. Regenerating the still for one shot adds
     * v2 alongside v1 — a new row, never an overwrite (spec 15「新生成版本不得覆蓋原檔」).
     */
    version: integer('version').notNull().default(1),
    /** Points at the v1 row of this lineage; null when this row *is* v1. */
    rootAssetId: uuid('root_asset_id'),
    uploadStatus: uploadStatusEnum('upload_status').notNull().default('PENDING'),
    tags: text('tags').array().notNull().default([]),
    note: text('note').notNull().default(''),
    /** Licence / provenance, so generated and licensed material stay distinguishable. */
    license: text('license').notNull().default(''),
    /** Generation provenance: model, prompt, seed. Null for hand-uploaded files. */
    generationMeta: jsonb('generation_meta'),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assets_project_kind_idx').on(t.projectId, t.kind),
    index('assets_episode_idx').on(t.episodeId),
    index('assets_status_idx').on(t.uploadStatus),
    index('assets_root_idx').on(t.rootAssetId),
  ]
)

/**
 * Tracks one in-flight upload, including R2 multipart state, so a large file can
 * resume or retry rather than restart (spec 42「分段上傳、取消與失敗重試」).
 */
export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    /** R2/S3 multipart upload id. Null for a single-PUT upload. */
    multipartUploadId: text('multipart_upload_id'),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
    uploadedBytes: bigint('uploaded_bytes', { mode: 'number' }).notNull().default(0),
    partSizeBytes: integer('part_size_bytes').notNull().default(0),
    totalParts: integer('total_parts').notNull().default(1),
    /** Completed parts as `[{ partNumber, etag, size }]`, needed to finalise. */
    completedParts: jsonb('completed_parts').notNull().default([]),
    status: uploadStatusEnum('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error').notNull().default(''),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('upload_sessions_asset_idx').on(t.assetId),
    index('upload_sessions_status_idx').on(t.status),
  ]
)

/** Free-form link table so one asset can attach to several records. */
export const assetLinks = pgTable(
  'asset_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** 'shot' | 'character' | 'task' | 'world_entry' | 'document' | 'expense' */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** Role of the asset for that entity, e.g. 'ref' | 'first_frame' | 'last_frame' | 'result'. */
    slot: text('slot').notNull().default(''),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('asset_links_unique').on(t.assetId, t.entityType, t.entityId, t.slot),
    index('asset_links_entity_idx').on(t.entityType, t.entityId),
  ]
)

export const assetsRelations = relations(assets, ({ one, many }) => ({
  project: one(projects, { fields: [assets.projectId], references: [projects.id] }),
  episode: one(episodes, { fields: [assets.episodeId], references: [episodes.id] }),
  uploadedBy: one(users, { fields: [assets.uploadedById], references: [users.id] }),
  uploadSessions: many(uploadSessions),
  links: many(assetLinks),
  variants: many(assetVariants),
}))

export const uploadSessionsRelations = relations(uploadSessions, ({ one }) => ({
  asset: one(assets, { fields: [uploadSessions.assetId], references: [assets.id] }),
}))

export const assetLinksRelations = relations(assetLinks, ({ one }) => ({
  asset: one(assets, { fields: [assetLinks.assetId], references: [assets.id] }),
}))

/**
 * Derived renditions of an asset: thumbnails, crops, background-removed cuts,
 * transcodes, waveforms (spec v2 §6.2「原始素材與裁切、縮圖、去背等衍生素材分別保存」).
 *
 * The original upload is never modified and never represented here — it stays
 * in `assets`. A variant has its own R2 object, so deleting a crop can never
 * destroy the master, and regenerating a thumbnail cannot corrupt the source.
 */
export const assetVariants = pgTable(
  'asset_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: assetVariantKindEnum('kind').notNull(),
    /** Own R2 object key, distinct from the original's. */
    objectKey: text('object_key').notNull().unique(),
    mimeType: text('mime_type').notNull().default(''),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    durationSec: integer('duration_sec'),
    /** How it was produced: crop box, target size, model, parameters. */
    params: jsonb('params'),
    uploadStatus: uploadStatusEnum('upload_status').notNull().default('PENDING'),
    checksum: text('checksum').notNull().default(''),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One variant per kind per asset; regenerating replaces rather than piles up. */
    unique('asset_variants_asset_kind_key').on(t.assetId, t.kind),
    index('asset_variants_asset_idx').on(t.assetId),
  ]
)

export const assetVariantsRelations = relations(assetVariants, ({ one }) => ({
  asset: one(assets, { fields: [assetVariants.assetId], references: [assets.id] }),
}))
