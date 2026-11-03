import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { CurrencyValue } from '@/lib/money'

/**
 * 個人資料 (Z85).
 *
 * Name, email, handle, title, colour and display currency. A member edits
 * their own; the owner may also edit the other member's, because this is a
 * two-person studio and the alternative is one of them being locked out of a
 * typo in their own email with nobody able to fix it.
 *
 * Password lives in `@/lib/auth/password` and changes through its own route,
 * which revokes other sessions — a different operation with different
 * consequences, and not something to bundle into a profile save.
 */

export type ProfileEdit = {
  name?: string
  email?: string
  account?: string
  title?: string
  color?: string
  displayCurrency?: CurrencyValue
}

export type ProfileRow = {
  id: string
  name: string
  email: string
  account: string
  title: string
  color: string
  displayCurrency: CurrencyValue
  role: string
}

export async function listMembers(): Promise<ProfileRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      account: users.account,
      title: users.title,
      color: users.color,
      displayCurrency: users.displayCurrency,
      role: users.role,
    })
    .from(users)
    .orderBy(users.createdAt)

  return rows.map((row) => ({
    ...row,
    displayCurrency: row.displayCurrency as CurrencyValue,
  }))
}

export async function updateProfile(
  targetId: string,
  edit: ProfileEdit
): Promise<ProfileRow> {
  /*
   * Email and handle are both unique, and both are how someone signs in.
   * Checking first turns a database constraint error \u2014 which says nothing a
   * person can act on \u2014 into a sentence naming the field.
   */
  if (edit.email !== undefined) {
    const email = edit.email.trim().toLowerCase()
    if (!email) throw ApiError.badRequest('Email \u4e0d\u80fd\u7a7a\u767d')

    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, ne(users.id, targetId)))
      .limit(1)

    if (taken) throw ApiError.badRequest('\u9019\u500b Email \u5df2\u7d93\u6709\u4eba\u5728\u7528')
    edit.email = email
  }

  if (edit.account !== undefined) {
    const account = edit.account.trim()

    /*
     * An empty handle is allowed \u2014 it means 「\u53ea\u7528 Email \u767b\u5165」. The unique
     * index is partial for exactly this reason, so two blank handles do not
     * collide; see `0003_login_account`.
     */
    if (account) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.account}) = ${account.toLowerCase()}`, ne(users.id, targetId)))
        .limit(1)

      if (taken) throw ApiError.badRequest('\u9019\u500b\u5e33\u865f\u5df2\u7d93\u6709\u4eba\u5728\u7528')
    }
    edit.account = account
  }

  if (edit.name !== undefined && !edit.name.trim()) {
    throw ApiError.badRequest('\u540d\u5b57\u4e0d\u80fd\u7a7a\u767d')
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(edit.name !== undefined ? { name: edit.name.trim() } : {}),
      ...(edit.email !== undefined ? { email: edit.email } : {}),
      ...(edit.account !== undefined ? { account: edit.account } : {}),
      ...(edit.title !== undefined ? { title: edit.title.trim() } : {}),
      ...(edit.color !== undefined ? { color: edit.color } : {}),
      ...(edit.displayCurrency !== undefined
        ? { displayCurrency: edit.displayCurrency }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetId))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      account: users.account,
      title: users.title,
      color: users.color,
      displayCurrency: users.displayCurrency,
      role: users.role,
    })

  if (!updated) throw ApiError.notFound('\u627e\u4e0d\u5230\u9019\u4f4d\u6210\u54e1')

  return { ...updated, displayCurrency: updated.displayCurrency as CurrencyValue }
}
