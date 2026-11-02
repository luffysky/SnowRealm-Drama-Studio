import { relations } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { roleEnum } from './enums'

/**
 * Exactly two rows exist, seeded by `npm run db:seed`. There is no
 * self-registration route and no OAuth; `passwordHash` is bcrypt.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    /** Job title shown in the team page, e.g. CEO / 技術總監. */
    title: text('title').notNull().default(''),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('OWNER'),
    /** Accent colour identifying this member across assignee chips. */
    color: text('color').notNull().default('#a78bfa'),
    avatarAssetId: uuid('avatar_asset_id'),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_email_idx').on(t.email)]
)

/**
 * Server-side session records. The cookie carries a signed JWT whose `sid`
 * points here, so a session can be revoked (spec 49「登入裝置／Session 撤銷」)
 * without rotating AUTH_SECRET for everyone.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Truncated UA string, for the device list. */
    userAgent: text('user_agent').notNull().default(''),
    ipAddress: text('ip_address').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)]
)

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))
