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
import { assets } from './assets'
import { users } from './auth'
import {
  audioCategoryEnum,
  audioReviewStatusEnum,
  audioVariantEnum,
  licenseStatusEnum,
} from './enums'

/**
 * 音訊素材 (designs 81–90).
 *
 * These extend `assets`; they do not replace it. The decision (2026-11-04) was
 * explicit: keep one asset table, keep `object_key` / `version` /
 * `root_asset_id`, and keep the thirty columns across the schema that point at
 * `assets.id`. Splitting files into a second table would have meant touching
 * every one of those references and inventing an "asset with no file" state.
 *
 * ## The anchor rule
 *
 * A *track* is identified by one asset row — the canonical one. `audio_metadata`
 * and `asset_licenses` hang off that id. Every file belonging to the track,
 * **including the canonical file itself**, gets a row in `audio_revisions`.
 *
 * So a track with only an original upload has one `audio_revisions` row whose
 * `fileAssetId` equals its `assetId`. That looks redundant for one file and
 * stops looking redundant the moment an instrumental arrives: the grid of
 * (revision × variant) has somewhere to live, and no code has to special-case
 * "the one without a row".
 */

/* -------------------------------------------------------------------------- */
/* 82 / 86 / 87 — metadata                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One row per track, keyed by its canonical asset.
 *
 * Separate from `assets` rather than more columns on it: an image has no mood
 * tags and no BPM, and eleven nullable audio columns on the table every cover
 * and storyboard still reads is how a shared table stops being shared.
 */
export const audioMetadata = pgTable(
  'audio_metadata',
  {
    /** The canonical asset. One metadata row per track. */
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    category: audioCategoryEnum('category').notNull().default('OTHER'),
    /** 風格：古風 / 大氣 / 勵志… */
    genreTags: text('genre_tags').array().notNull().default([]),
    /** 情緒：磅礡 / 熱血 / 溫暖… */
    moodTags: text('mood_tags').array().notNull().default([]),
    language: text('language').notNull().default(''),
    artist: text('artist').notNull().default(''),
    /**
     * Nullable on purpose. An unknown BPM is not 0, and storing 0 would put a
     * wrong number in a filter rather than leaving it out of one.
     */
    bpm: integer('bpm'),
    musicalKey: text('musical_key').notNull().default(''),
    /** 來源平台: Suno AI / 自製錄音 / 商用音效庫 / 授權音樂… */
    sourcePlatform: text('source_platform').notNull().default(''),
    description: text('description').notNull().default(''),
    /**
     * 歌詞，存成 LRC 或純文字 (Z125).
     *
     * One text column rather than a table of timed lines, for three reasons:
     *
     *  - **LRC is already the interchange format.** `[mm:ss.xx]` per line has
     *    been what karaoke and every music player speak for twenty years, so
     *    a file exported here opens elsewhere and vice versa.
     *  - **It is plain text.** When a timing is wrong it is readable and
     *    fixable by hand; a bespoke JSON structure is only legible to this app.
     *  - **Rows would buy nothing.** Nothing queries an individual line —
     *    the whole sheet is loaded, parsed once, and followed in the browser.
     *
     * Untimed lyrics live here too, as plain lines; `parseLyrics` tells them
     * apart and the player shows them without following along, which is the
     * truthful behaviour rather than a missing feature.
     */
    lyrics: text('lyrics').notNull().default(''),
    /** Set when the lyrics were last written, for 「誰先打的時間碼」. */
    lyricsUpdatedAt: timestamp('lyrics_updated_at', { withTimezone: true }),
    /** 是否為 AI 生成，連同生成當時的方案與條款證據。 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audio_metadata_category_idx').on(t.category)]
)

/* -------------------------------------------------------------------------- */
/* 85 — revisions × variants                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The (revision × variant) grid for one track.
 *
 * Two independent axes, which is why one column could not carry both:
 *
 * - `revision` — v1, v2: the same piece, remastered or re-rendered.
 * - `variant` — full / instrumental / short / vocal: different cuts, each its
 *   own recording with its own duration and checksum.
 *
 * v2 的伴奏 is a real cell in that grid, and a single "version" column cannot
 * name it.
 */
export const audioRevisions = pgTable(
  'audio_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The track's canonical asset — the anchor, not necessarily this file. */
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** The actual file for this cell. Equals `assetId` for the original. */
    fileAssetId: uuid('file_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(1),
    variant: audioVariantEnum('variant').notNull().default('FULL'),
    reviewStatus: audioReviewStatusEnum('review_status').notNull().default('DRAFT'),
    /**
     * Which cell is used when nothing asks for a specific one.
     *
     * Switching it must not silently change an episode that already shipped —
     * a published episode pins the revision it was published with (spec §2-85).
     */
    isDefault: boolean('is_default').notNull().default(false),
    note: text('note').notNull().default(''),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('audio_revisions_cell_key').on(t.assetId, t.revision, t.variant),
    index('audio_revisions_asset_idx').on(t.assetId),
    index('audio_revisions_file_idx').on(t.fileAssetId),
  ]
)

/* -------------------------------------------------------------------------- */
/* 88 — licensing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 授權紀錄 (design 88).
 *
 * The reason this is a table and not the `assets.license` text column it
 * replaces: 88 asks "which episodes are affected if this licence expires",
 * "what is due for renewal in 90 days", and "was this cleared for 串流".
 * None of those are answerable from prose.
 *
 * `status` defaults to `PENDING_REVIEW`. Uploading a file is not licensing it,
 * and 已授權 must never appear for a row nobody confirmed (spec §2-88).
 */
export const assetLicenses = pgTable(
  'asset_licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** Null when the licence covers the whole track rather than one cut. */
    audioRevisionId: uuid('audio_revision_id').references(() => audioRevisions.id, {
      onDelete: 'cascade',
    }),
    status: licenseStatusEnum('status').notNull().default('PENDING_REVIEW'),
    /** Human-readable licence number, e.g. LIC-SFX-20261020-004. */
    reference: text('reference').notNull().default(''),
    rightsHolder: text('rights_holder').notNull().default(''),
    /** 來源平台 / 取得方式. */
    source: text('source').notNull().default(''),
    licenseType: text('license_type').notNull().default(''),
    /** 允許用途：劇集 / 宣傳 / 串流 / 商用… */
    allowedUses: text('allowed_uses').array().notNull().default([]),
    territories: text('territories').array().notNull().default([]),
    /** 使用限制，逐條列。 */
    restrictions: text('restrictions').array().notNull().default([]),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    /** Null means no expiry — not "unknown". Unknown stays PENDING_REVIEW. */
    validUntil: timestamp('valid_until', { withTimezone: true }),
    /**
     * AI-generated material: the plan in force when it was generated, and the
     * evidence for it. A subscription is not an unconditional grant of
     * copyright, so the claim has to carry its own proof (spec §2-88).
     */
    aiGeneratedAt: timestamp('ai_generated_at', { withTimezone: true }),
    aiPlanSnapshot: text('ai_plan_snapshot').notNull().default(''),
    note: text('note').notNull().default(''),
    reviewedById: uuid('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('asset_licenses_asset_idx').on(t.assetId),
    index('asset_licenses_status_idx').on(t.status),
    index('asset_licenses_expiry_idx').on(t.validUntil),
  ]
)

/** 授權文件 — the PDF itself is an asset like anything else. */
export const assetLicenseDocuments = pgTable(
  'asset_license_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    licenseId: uuid('license_id')
      .notNull()
      .references(() => assetLicenses.id, { onDelete: 'cascade' }),
    fileAssetId: uuid('file_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('asset_license_documents_license_idx').on(t.licenseId)]
)

/* -------------------------------------------------------------------------- */

export const audioMetadataRelations = relations(audioMetadata, ({ one }) => ({
  asset: one(assets, { fields: [audioMetadata.assetId], references: [assets.id] }),
}))

export const audioRevisionsRelations = relations(audioRevisions, ({ one, many }) => ({
  track: one(assets, { fields: [audioRevisions.assetId], references: [assets.id] }),
  file: one(assets, { fields: [audioRevisions.fileAssetId], references: [assets.id] }),
  licenses: many(assetLicenses),
}))

export const assetLicensesRelations = relations(assetLicenses, ({ one, many }) => ({
  asset: one(assets, { fields: [assetLicenses.assetId], references: [assets.id] }),
  revision: one(audioRevisions, {
    fields: [assetLicenses.audioRevisionId],
    references: [audioRevisions.id],
  }),
  documents: many(assetLicenseDocuments),
}))

export const assetLicenseDocumentsRelations = relations(assetLicenseDocuments, ({ one }) => ({
  license: one(assetLicenses, {
    fields: [assetLicenseDocuments.licenseId],
    references: [assetLicenses.id],
  }),
  file: one(assets, { fields: [assetLicenseDocuments.fileAssetId], references: [assets.id] }),
}))
