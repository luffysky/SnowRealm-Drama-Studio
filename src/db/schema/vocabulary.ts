import { relations } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'

/**
 * 使用者自己加的下拉選項 (Z184).
 *
 * 景別與運鏡本來是 pg enum，而 enum 加不了值——`ALTER TYPE ADD VALUE` 不能在
 * 交易裡跑、要 DDL 權限，而且**加進去就刪不掉**（Postgres 沒有 `DROP VALUE`）。
 * 打錯一個字會永遠留在下拉裡。
 *
 * 所以那兩個欄位改成 text，合法值由應用程式把關：內建的那幾個 ∪ 這張表。資料
 * 庫不再替我們擋亂寫的值，換來的是這個功能能存在、而且打錯可以刪掉。
 *
 * **不是每一個下拉都該接上來。** 這個 schema 有 39 個 enum，其中一半是程式在
 * 判斷的（上傳狀態、任務狀態、AI 任務狀態、通話狀態）——多一個值出來，完成判
 * 定、看板分欄、篩選器會各自用各自的方式忽略它。那不是多一個選項，是三個地方
 * 各壞一種壞法。只有**純標籤**的欄位可以接：景別、運鏡就是。
 *
 * 沒有 `project_id`：這是一間兩個人、兩部作品的工作室，而「景別」是電影語言，
 * 不是某一部戲的設定。
 */
export const vocabularyTerms = pgTable(
  'vocabulary_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `VOCABULARY_KINDS` 裡的一個。 */
    kind: text('kind').notNull(),
    /** 存進資料欄位的值。大寫英數底線，跟內建的那幾個同一種長相。 */
    value: text('value').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 同一類裡不能有兩個一樣的值，否則下拉會出現兩個長得一樣的選項。
    unique('vocabulary_terms_unique').on(t.kind, t.value),
    index('vocabulary_terms_kind_idx').on(t.kind, t.sortOrder),
  ]
)

export const vocabularyTermsRelations = relations(vocabularyTerms, ({ one }) => ({
  createdBy: one(users, { fields: [vocabularyTerms.createdById], references: [users.id] }),
}))
