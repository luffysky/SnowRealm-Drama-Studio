import { relations } from 'drizzle-orm'
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { episodes, projects } from './catalog'
import { characterTierEnum } from './enums'

/**
 * 角色. The row `id` is the stable identity — renaming a character keeps it
 * (spec 36「姓名可修改但 ID 固定」). The female lead's name is undecided and is
 * stored empty rather than guessed.
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    alias: text('alias').notNull().default(''),
    tier: characterTierEnum('tier').notNull().default('SUPPORTING'),
    age: text('age').notNull().default(''),
    gender: text('gender').notNull().default(''),
    /** 外型 / 服裝 / 髮型 */
    appearance: text('appearance').notNull().default(''),
    personality: text('personality').notNull().default(''),
    background: text('background').notNull().default(''),
    /** Character arc / growth across the season. */
    growth: text('growth').notNull().default(''),
    /**
     * Locked prompt reused for every still of this character, so the look stays
     * consistent across 120 episodes.
     */
    visualPrompt: text('visual_prompt').notNull().default(''),
    negativePrompt: text('negative_prompt').notNull().default(''),
    /** 聲線 */
    voiceProvider: text('voice_provider').notNull().default(''),
    voiceId: text('voice_id').notNull().default(''),
    voiceStyle: text('voice_style').notNull().default(''),
    voiceNote: text('voice_note').notNull().default(''),
    /** 定妝照 — the approved key visual. */
    keyVisualAssetId: uuid('key_visual_asset_id'),
    voiceSampleAssetId: uuid('voice_sample_asset_id'),
    /** Soft delete (spec v2 §5「重要刪除採 soft delete」). Queries filter this out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('characters_project_name_key').on(t.projectId, t.name),
    index('characters_project_idx').on(t.projectId),
    index('characters_tier_idx').on(t.tier),
  ]
)

/**
 * Directed relationship between two characters, optionally bounded to a span of
 * episodes so a relationship can change over time (spec 38).
 */
export const characterRelationships = pgTable(
  'character_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromCharacterId: uuid('from_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    toCharacterId: uuid('to_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** e.g. 師徒 / 兄妹 / 競爭對手 */
    kind: text('kind').notNull(),
    description: text('description').notNull().default(''),
    /** -100 (hostile) .. 100 (devoted); drives the relationship graph colouring. */
    sentiment: integer('sentiment').notNull().default(0),
    fromEpisodeNumber: integer('from_episode_number'),
    toEpisodeNumber: integer('to_episode_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('char_rel_from_idx').on(t.fromCharacterId),
    index('char_rel_to_idx').on(t.toCharacterId),
    index('char_rel_project_idx').on(t.projectId),
  ]
)

/** Which characters appear in which episode. */
export const episodeCharacters = pgTable(
  'episode_characters',
  {
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    note: text('note').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.episodeId, t.characterId] }),
    index('episode_characters_character_idx').on(t.characterId),
  ]
)

export const charactersRelations = relations(characters, ({ one, many }) => ({
  project: one(projects, { fields: [characters.projectId], references: [projects.id] }),
  episodes: many(episodeCharacters),
}))

export const characterRelationshipsRelations = relations(characterRelationships, ({ one }) => ({
  fromCharacter: one(characters, {
    fields: [characterRelationships.fromCharacterId],
    references: [characters.id],
    relationName: 'from_character',
  }),
  toCharacter: one(characters, {
    fields: [characterRelationships.toCharacterId],
    references: [characters.id],
    relationName: 'to_character',
  }),
}))

export const episodeCharactersRelations = relations(episodeCharacters, ({ one }) => ({
  episode: one(episodes, { fields: [episodeCharacters.episodeId], references: [episodes.id] }),
  character: one(characters, {
    fields: [episodeCharacters.characterId],
    references: [characters.id],
  }),
}))
