import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { activities, users } from '@/db/schema'
import { PERMISSIONS, roleCan, type Permission } from '@/lib/auth/rbac'
import { ROLE_LABEL, type RoleValue } from '@/lib/constants'

/**
 * 團隊管理 (Z44).
 *
 * 側邊欄上掛著這一項、標著 M4，而畫面從來沒有做出來。
 *
 * ## 按 user_id 歸戶，不是按顯示名
 *
 * `activities.user_name` 是**反正規化**存的，schema 的註解寫明了理由：
 * 「so the feed still reads correctly if a user row changes」。那是對的——
 * 當時誰做的就該顯示當時的稱呼。
 *
 * 但副作用是同一個人會以不同名字散在列表裡。實測這個工作室：
 *
 *     luffysky00    記成「Luffy」201 筆（另有 91 筆原本記成「林鍶恩」）
 *     nianpeekaboo  記成「暖寶」126 筆、記成「煙火」4 筆
 *
 * 按名字分組會變成四個人，而實際上是兩個。所以這裡一律按 `user_id` 歸戶，
 * 把歷史名稱當成附註列出來——**不改資料**，那是刻意留下的紀錄。
 *
 * ## 權限表是算出來的
 *
 * 不手寫「擁有者能做什麼」，直接跑 `roleCan()`。手寫的那份會跟程式碼分岔，
 * 而分岔之後畫面會說一件跟實際授權不一樣的事——那比沒有這張表更糟。
 */

export type TeamMember = {
  id: string
  name: string
  email: string
  account: string
  title: string
  color: string
  role: RoleValue
  roleLabel: string
  /** 這個人做過幾件事。 */
  actions: number
  lastActiveAt: Date | null
  /** 以前用過的顯示名，現在這個不算。 */
  formerNames: { name: string; count: number }[]
}

export type TeamActivity = {
  id: string
  userId: string | null
  /** 當時記下的名字，不是現在的。 */
  recordedAs: string
  action: string
  entityType: string
  summary: string
  at: Date
}

export type PermissionRow = {
  permission: Permission
  ownerOnly: boolean
}

export type TeamOverview = {
  members: TeamMember[]
  recent: TeamActivity[]
  permissions: PermissionRow[]
  /** 動態紀錄裡找不到對應使用者的筆數——通常是系統自己做的事。 */
  unattributed: number
}

export async function teamOverview(limit = 30): Promise<TeamOverview> {
  const [memberRows, byUser, nameRows, recent, orphans] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        account: users.account,
        title: users.title,
        color: users.color,
        role: users.role,
      })
      .from(users)
      .orderBy(users.createdAt),

    db
      .select({
        userId: activities.userId,
        actions: sql<number>`count(*)::int`,
        lastAt: sql<Date | null>`max(${activities.createdAt})`,
      })
      .from(activities)
      .groupBy(activities.userId),

    // 每個人用過哪些顯示名，各幾筆。
    db
      .select({
        userId: activities.userId,
        name: activities.userName,
        count: sql<number>`count(*)::int`,
      })
      .from(activities)
      .groupBy(activities.userId, activities.userName),

    db
      .select({
        id: activities.id,
        userId: activities.userId,
        recordedAs: activities.userName,
        action: activities.action,
        entityType: activities.entityType,
        summary: activities.summary,
        at: activities.createdAt,
      })
      .from(activities)
      .orderBy(desc(activities.createdAt))
      .limit(limit),

    db
      .select({ n: sql<number>`count(*)::int` })
      .from(activities)
      .where(sql`${activities.userId} is null`),
  ])

  const counts = new Map(byUser.map((row) => [row.userId ?? '', row]))

  const members: TeamMember[] = memberRows.map((row) => {
    const stats = counts.get(row.id)

    /*
     * 舊顯示名：同一個 user_id 底下、跟現在名字不同的那些。
     *
     * 這不是髒資料，是紀錄。「煙火」就是暖寶以前的名字，而那四筆動態當時
     * 顯示的就是「煙火」——改掉反而會讓歷史失真。
     */
    const formerNames = nameRows
      .filter((name) => name.userId === row.id && name.name && name.name !== row.name)
      .map((name) => ({ name: name.name, count: name.count }))
      .sort((a, b) => b.count - a.count)

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      account: row.account,
      title: row.title,
      color: row.color,
      role: row.role as RoleValue,
      roleLabel: ROLE_LABEL[row.role as RoleValue] ?? row.role,
      actions: stats?.actions ?? 0,
      lastActiveAt: stats?.lastAt ?? null,
      formerNames,
    }
  })

  return {
    members,
    recent,
    /*
     * 權限表**算出來**而不是手寫。手寫的那份會跟 `rbac.ts` 分岔，而分岔之後
     * 畫面會說一件跟實際授權不一樣的事。
     */
    permissions: PERMISSIONS.map((permission) => ({
      permission,
      ownerOnly: !roleCan('COLLABORATOR', permission),
    })),
    unattributed: orphans[0]?.n ?? 0,
  }
}

/** 一個人做過的事，給成員詳情用。 */
export async function memberActivity(userId: string, limit = 40): Promise<TeamActivity[]> {
  return db
    .select({
      id: activities.id,
      userId: activities.userId,
      recordedAs: activities.userName,
      action: activities.action,
      entityType: activities.entityType,
      summary: activities.summary,
      at: activities.createdAt,
    })
    .from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
}
