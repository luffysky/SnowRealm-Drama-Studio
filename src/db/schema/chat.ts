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
import { users } from './auth'
import { assets } from './assets'
import { callStateEnum, messageKindEnum } from './enums'

/**
 * 即時對話 (Z99).
 *
 * Two people, so a conversation could have been a single hardcoded row. It is
 * a table anyway because the alternative — messages with no conversation —
 * makes every later question ("how many unread", "search within this thread")
 * a special case, and because a project-scoped thread is an obvious next ask.
 *
 * Vercel cannot hold a WebSocket open, so delivery is Server-Sent Events with
 * polling as the fallback (`docs/CHAT.md`). That shapes the schema: every
 * change a client needs to hear about carries a monotonic `seq`, so a
 * reconnecting client asks for everything after the last one it saw rather
 * than re-fetching the thread.
 */

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Empty for a direct thread; set for a named group. */
  title: text('title').notNull().default(''),
  /**
   * Monotonic within the conversation, assigned on insert.
   *
   * Not a timestamp: two messages in the same millisecond are indistinguishable
   * by time, and a reconnecting client would either miss one or replay it.
   */
  lastSeq: integer('last_seq').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const conversationMembers = pgTable(
  'conversation_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The highest `seq` this member has read. Unread is everything above it. */
    readSeq: integer('read_seq').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('conversation_members_unique').on(t.conversationId, t.userId),
    index('conversation_members_user_idx').on(t.userId),
  ]
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Null when the sender's account is deleted; the message stays. */
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    seq: integer('seq').notNull(),
    kind: messageKindEnum('kind').notNull().default('TEXT'),
    body: text('body').notNull().default(''),
    /**
     * The attached file, for an image / video / audio / voice / file message.
     * No foreign key, consistent with every other asset reference here; the
     * send path checks ownership and upload status instead.
     */
    assetId: uuid('asset_id'),
    /** Voice note and video length, so the bubble can size itself before loading. */
    durationSec: integer('duration_sec'),
    /** The message this one replies to. Kept when that one is recalled. */
    replyToId: uuid('reply_to_id'),
    /**
     * Set when the sender takes the message back.
     *
     * The row stays and `body` is cleared, rather than the row being deleted:
     * the other person may already have it on screen, and a hole in the
     * sequence would make a reconnecting client think it had missed something.
     */
    recalledAt: timestamp('recalled_at', { withTimezone: true }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Bumped by a recall or an edit.
     *
     * The live protocol asks for everything above a sequence number, which
     * only ever carries *new* messages. A recall does not change `seq` — it
     * must not, or the message would jump to the bottom of the thread — so
     * without this the other side never heard about it and had to reload.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Said by the assistant rather than a member.
     *
     * A column rather than a null `sender_id`, because a deleted account also
     * leaves that null — and 「助理說的」 and 「寄件人已離開」 must not
     * render the same way.
     */
    fromAssistant: boolean('from_assistant').notNull().default(false),
    /** The message that triggered this reply, for a turn's provenance. */
    repliesToId: uuid('replies_to_id'),
  },
  (t) => [
    unique('messages_conversation_seq').on(t.conversationId, t.seq),
    index('messages_conversation_updated_idx').on(t.conversationId, t.updatedAt),
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    // History search runs over `body`; pg_trgm is already installed.
    index('messages_body_idx').using('gin', t.body),
  ]
)

/**
 * Who is online, and who is typing.
 *
 * A row per member, overwritten by a heartbeat, rather than an append-only
 * log: nobody needs yesterday's presence, and a log of it would grow without
 * limit for information that is worthless a minute later.
 */
export const presence = pgTable('presence', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set while composing; read as stale after a few seconds. */
  typingInId: uuid('typing_in_id').references(() => conversations.id, { onDelete: 'set null' }),
  typingAt: timestamp('typing_at', { withTimezone: true }),
})

/**
 * A call, and the WebRTC handshake that sets it up.
 *
 * The signalling (offer / answer / ICE candidates) rides the same SSE channel
 * as messages rather than a second transport: it is a handful of small
 * payloads exchanged once per call, and a separate socket would be a separate
 * thing to reconnect.
 */
export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    callerId: uuid('caller_id').references(() => users.id, { onDelete: 'set null' }),
    /** Whether the caller asked for camera as well as microphone. */
    video: text('video').notNull().default('false'),
    state: callStateEnum('state').notNull().default('RINGING'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('calls_conversation_idx').on(t.conversationId, t.createdAt)]
)

/**
 * One SDP or ICE payload, waiting to be delivered.
 *
 * Rows are consumed by the recipient's stream and deleted afterwards. They
 * exist at all because an SSE connection drops every minute on Vercel, and a
 * candidate that arrived during a reconnect would otherwise be lost — which
 * fails the call with no error anyone can act on.
 */
export const callSignals = pgTable(
  'call_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id').references(() => users.id, { onDelete: 'set null' }),
    toUserId: uuid('to_user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** 'offer' | 'answer' | 'ice'. */
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('call_signals_to_idx').on(t.toUserId, t.createdAt)]
)

/* -------------------------------------------------------------------------- */

export const conversationRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
  messages: many(messages),
}))

export const conversationMemberRelations = relations(conversationMembers, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMembers.conversationId],
    references: [conversations.id],
  }),
  user: one(users, { fields: [conversationMembers.userId], references: [users.id] }),
}))

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  asset: one(assets, { fields: [messages.assetId], references: [assets.id] }),
}))

/**
 * 助理的修改提案 (Z100).
 *
 * The assistant never writes to the work directly. It proposes, against a
 * snapshot of what it was shown, and a person decides. Applying takes a
 * `versions` snapshot of whatever is there at that moment first — so
 * 「取代」 and 「取代並備份原來的」 are the same code path. Backing up is
 * not an option on the dialog; it is part of applying. Overwriting without
 * one would give a model the power to delete something a person wrote.
 *
 * `beforeValue` is kept so a proposal can be shown as a diff later, and so
 * one raised against content that has since changed can be marked STALE
 * rather than silently applied over somebody's newer work.
 */
export const assistantProposals = pgTable(
  'assistant_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    projectId: uuid('project_id'),
    /** 'chapter' | 'episode_outline' | 'character' | 'world_entry' */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    field: text('field').notNull(),
    beforeValue: text('before_value').notNull().default(''),
    afterValue: text('after_value').notNull().default(''),
    rationale: text('rationale').notNull().default(''),
    /** PENDING | APPLIED | REJECTED | STALE */
    state: text('state').notNull().default('PENDING'),
    /** The snapshot of what was replaced, created when applying. */
    backupVersionId: uuid('backup_version_id'),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assistant_proposals_conversation_idx').on(t.conversationId, t.createdAt),
    index('assistant_proposals_target_idx').on(t.targetType, t.targetId, t.state),
  ]
)
