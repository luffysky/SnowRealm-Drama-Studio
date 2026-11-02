import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { securityEventKindEnum } from './enums'

/**
 * Security audit trail, and the backing store for login rate limiting
 * (spec v2 §5 `security_events`, §6.3 登入限速).
 *
 * Rate limiting has to be persistent: Vercel runs each request in a possibly
 * fresh instance, so an in-memory counter would reset constantly and limit
 * nothing. Counting rows in a time window is the only thing that holds across
 * instances without adding another service.
 *
 * No row here ever contains a password, a hash, or a session token.
 */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: securityEventKindEnum('kind').notNull(),
    /** Null for an attempt against an address that matched no account. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Lower-cased email the attempt was made against. Kept even when no user
     * matched, so the limiter can throttle per address.
     */
    email: text('email').notNull().default(''),
    ipAddress: text('ip_address').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    /** Short machine-readable reason, e.g. 'bad_password' | 'rate_limited'. */
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The two lookups the limiter performs on every login attempt.
    index('security_events_email_time_idx').on(t.email, t.kind, t.createdAt),
    index('security_events_ip_time_idx').on(t.ipAddress, t.kind, t.createdAt),
    index('security_events_user_idx').on(t.userId, t.createdAt),
  ]
)

export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
  user: one(users, { fields: [securityEvents.userId], references: [users.id] }),
}))
