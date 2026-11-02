import { relations } from 'drizzle-orm'
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { episodes, projects } from './catalog'
import { expenseCategoryEnum, usageKindEnum, usageSourceEnum } from './enums'

/**
 * 成本紀錄 — internal bookkeeping for what production spends. This is not a
 * billing or subscription system; nothing here charges anyone.
 *
 * Amounts use `numeric` (exact decimal), never float. The original currency and
 * the rate used are both kept, so a converted figure is always reproducible
 * (spec 23「保留原始幣別與匯率，金額不可虛構」).
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    category: expenseCategoryEnum('category').notNull().default('OTHER'),
    description: text('description').notNull(),
    /** Amount as entered, in `currency`. */
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('TWD'),
    /** Rate to the reporting currency at the time of entry. 1 when same. */
    exchangeRate: numeric('exchange_rate', { precision: 14, scale: 6 }).notNull().default('1'),
    /** Reporting currency the dashboard totals in. */
    baseCurrency: text('base_currency').notNull().default('TWD'),
    spentAt: timestamp('spent_at', { withTimezone: true }).notNull().defaultNow(),
    /** Who actually paid. */
    paidById: uuid('paid_by_id').references(() => users.id, { onDelete: 'set null' }),
    vendor: text('vendor').notNull().default(''),
    /** Receipt image / PDF in R2. */
    receiptAssetId: uuid('receipt_asset_id'),
    /** Set when this cost came from an AI job, for per-job cost attribution. */
    aiJobId: uuid('ai_job_id'),
    note: text('note').notNull().default(''),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('expenses_project_category_idx').on(t.projectId, t.category),
    index('expenses_spent_at_idx').on(t.spentAt),
    index('expenses_episode_idx').on(t.episodeId),
  ]
)

/** A spending cap per project, optionally scoped to one month and one category. */
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    category: expenseCategoryEnum('category'),
    /** Null for the whole project; otherwise `YYYY-MM`. */
    period: text('period'),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('TWD'),
    /** Warn at this percentage of the cap. */
    alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('budgets_scope_key').on(t.projectId, t.category, t.period)]
)

export const expensesRelations = relations(expenses, ({ one }) => ({
  project: one(projects, { fields: [expenses.projectId], references: [projects.id] }),
  episode: one(episodes, { fields: [expenses.episodeId], references: [episodes.id] }),
  paidBy: one(users, { fields: [expenses.paidById], references: [users.id] }),
}))

export const budgetsRelations = relations(budgets, ({ one }) => ({
  project: one(projects, { fields: [budgets.projectId], references: [projects.id] }),
}))

/**
 * Consumption ledger (spec v2 §5 `usage_ledger`, §6.7「預估與已實際發生費用分開紀錄」).
 *
 * Every billable unit lands here twice over its life: once as an ESTIMATE when
 * a job is queued, then as an ACTUAL when it settles. Keeping both as separate
 * rows — rather than overwriting an estimate — is what lets the cost page show
 * committed-but-unsettled spend, and what makes a budget check able to count
 * work already in flight.
 */
export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    source: usageSourceEnum('source').notNull(),
    kind: usageKindEnum('kind').notNull(),
    /** The ai_job / asset / expense this line describes. */
    refId: uuid('ref_id'),
    description: text('description').notNull().default(''),
    /** e.g. 'tokens' | 'bytes' | 'seconds' | 'requests'. */
    unit: text('unit').notNull().default(''),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('0'),
    amount: numeric('amount', { precision: 14, scale: 6 }).notNull().default('0'),
    currency: text('currency').notNull().default('USD'),
    /** `YYYY-MM`, so a monthly budget can be summed without date maths. */
    period: text('period').notNull(),
    /** Set on an ACTUAL row that settles an earlier ESTIMATE. */
    settlesId: uuid('settles_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_ledger_project_period_idx').on(t.projectId, t.period, t.kind),
    index('usage_ledger_ref_idx').on(t.source, t.refId),
    index('usage_ledger_occurred_idx').on(t.occurredAt),
  ]
)

export const usageLedgerRelations = relations(usageLedger, ({ one }) => ({
  project: one(projects, { fields: [usageLedger.projectId], references: [projects.id] }),
  episode: one(episodes, { fields: [usageLedger.episodeId], references: [episodes.id] }),
}))
