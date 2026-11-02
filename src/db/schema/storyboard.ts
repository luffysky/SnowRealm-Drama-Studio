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
import { episodes } from './catalog'
import { characters } from './characters'
import { cameraMoveEnum, shotSizeEnum, shotStatusEnum } from './enums'
import { scenes } from './writing'

/**
 * 分鏡鏡頭. This is a planning record, not a timeline in an editor — the sum of
 * `durationSec` across an episode is checked against the episode's target
 * runtime (spec 12「不是影片剪輯器；鏡頭時長須校驗」).
 */
export const shots = pgTable(
  'shots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
    /** Shot order within the episode, 1-based. */
    order: integer('order').notNull(),
    /** Scene label shown on the card, e.g. S03. */
    sceneCode: text('scene_code').notNull().default(''),
    durationSec: integer('duration_sec').notNull().default(5),
    shotSize: shotSizeEnum('shot_size').notNull().default('MS'),
    camera: cameraMoveEnum('camera').notNull().default('STATIC'),
    location: text('location').notNull().default(''),
    timeOfDay: text('time_of_day').notNull().default(''),
    /** 畫面描述 */
    action: text('action').notNull().default(''),
    /** 台詞 / 旁白 */
    dialogue: text('dialogue').notNull().default(''),
    speakerId: uuid('speaker_id').references(() => characters.id, { onDelete: 'set null' }),
    /** Image / video generation prompt. */
    prompt: text('prompt').notNull().default(''),
    negativePrompt: text('negative_prompt').notNull().default(''),
    /** 首尾幀 — first and last frame references for video generation. */
    firstFrameAssetId: uuid('first_frame_asset_id'),
    lastFrameAssetId: uuid('last_frame_asset_id'),
    /** 參考圖 */
    refAssetId: uuid('ref_asset_id'),
    /** Approved outputs. Candidates live in `assets` linked via asset_links. */
    imageAssetId: uuid('image_asset_id'),
    videoAssetId: uuid('video_asset_id'),
    voiceAssetId: uuid('voice_asset_id'),
    status: shotStatusEnum('status').notNull().default('TODO'),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('shots_episode_order_key').on(t.episodeId, t.order),
    index('shots_episode_order_idx').on(t.episodeId, t.order),
    index('shots_status_idx').on(t.status),
    index('shots_scene_idx').on(t.sceneId),
  ]
)

export const shotsRelations = relations(shots, ({ one }) => ({
  episode: one(episodes, { fields: [shots.episodeId], references: [episodes.id] }),
  scene: one(scenes, { fields: [shots.sceneId], references: [scenes.id] }),
  speaker: one(characters, { fields: [shots.speakerId], references: [characters.id] }),
}))
