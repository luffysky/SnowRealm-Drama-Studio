import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { episodes, projects, tasks, users } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { visibleProjects } from '@/lib/project-access'
import {
  TASK_STATUSES,
  type TaskPriorityValue,
  type TaskStatusValue,
} from '@/lib/constants'

/**
 * 跨作品任務 (Z89).
 *
 * 側邊欄上掛著這一項、標著 M3，而 `/tasks` 這個畫面從來沒有做出來。
 *
 * ## 跟另外兩頁不一樣的地方
 *
 * 成本中心有 27 筆真資料、團隊管理有 331 筆動態，做出來第一天就有東西看。
 * 這張表**一筆都沒有**——所以 Z89 不是「做一個檢視」，是「做出任務功能」：
 * 沒有建立的地方，這一頁會永遠是空的。
 *
 * ## 樂觀鎖要真的用
 *
 * `tasks.lock_revision` 這個欄位從第一支 migration 就在，schema 的註解寫明
 * 用途：「so two simultaneous board drags cannot silently clobber」。
 *
 * 不讀它的話，那就只是一個沒有人看的數字，而兩個人同時改同一張卡的時候，
 * 後寫的會**安靜地**蓋掉先寫的——不會報錯，只是其中一個人的修改消失了。
 * 所以更新一律帶 revision，對不上就拒絕並說明。
 */

export type TaskRow = {
  id: string
  title: string
  description: string
  status: TaskStatusValue
  priority: TaskPriorityValue
  progress: number
  projectId: string
  projectTitle: string
  episodeNumber: number | null
  assigneeId: string | null
  assigneeName: string | null
  dueDate: Date | null
  lockRevision: number
  updatedAt: Date
}

export type TaskBoard = {
  columns: { status: TaskStatusValue; tasks: TaskRow[] }[]
  total: number
  /** 過期未完成的，要在最上面講。 */
  overdue: number
  projects: { id: string; title: string }[]
  members: { id: string; name: string }[]
}

export async function taskBoard(userId: string): Promise<TaskBoard> {
  const [rows, projectRows, memberRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        progress: tasks.progress,
        projectId: tasks.projectId,
        projectTitle: projects.title,
        episodeNumber: episodes.number,
        assigneeId: tasks.assigneeId,
        assigneeName: users.name,
        dueDate: tasks.dueDate,
        lockRevision: tasks.lockRevision,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(episodes, eq(episodes.id, tasks.episodeId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(isNull(tasks.deletedAt), visibleProjects(userId)))
      .orderBy(asc(tasks.sortOrder), desc(tasks.updatedAt)),

    db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(visibleProjects(userId))
      .orderBy(asc(projects.createdAt)),

    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.createdAt)),
  ])

  const board = rows.map((row) => ({
    ...row,
    status: row.status as TaskStatusValue,
    priority: row.priority as TaskPriorityValue,
  }))

  const now = Date.now()

  return {
    columns: TASK_STATUSES.map((status) => ({
      status,
      tasks: board.filter((row) => row.status === status),
    })),
    total: board.length,
    /*
     * 已完成的不算過期。一張 DONE 的卡片就算期限早就過了，也不需要有人採取
     * 行動——把它算進去只會讓這個數字沒有人相信。
     */
    overdue: board.filter(
      (row) => row.status !== 'DONE' && row.dueDate && row.dueDate.getTime() < now
    ).length,
    projects: projectRows,
    members: memberRows,
  }
}

export async function createTask(input: {
  projectId: string
  episodeId?: string | null
  title: string
  description?: string
  status?: TaskStatusValue
  priority?: TaskPriorityValue
  assigneeId?: string | null
  dueDate?: string
  user: SessionUser
}): Promise<{ id: string }> {
  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
    .limit(1)

  if (!project) throw ApiError.notFound('找不到這部作品')

  /*
   * 新卡片放在那一欄的最後面。
   *
   * 不給 sortOrder 的話每一張都是 0，而排序就退化成「依更新時間」——卡片會
   * 在你改了別張之後自己跳位置。
   */
  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), 0)` })
    .from(tasks)
    .where(and(eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt)))

  const due = input.dueDate?.trim() ? new Date(input.dueDate) : null

  const [row] = await db
    .insert(tasks)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'TODO',
      priority: input.priority ?? 'NORMAL',
      assigneeId: input.assigneeId ?? null,
      sortOrder: (last?.max ?? 0) + 1,
      ...(due && !Number.isNaN(due.getTime()) ? { dueDate: due } : {}),
      createdById: input.user.id,
    })
    .returning({ id: tasks.id })

  if (!row) throw new Error('Failed to create task')

  await logActivity({
    user: input.user,
    action: 'create',
    entityType: 'task',
    entityId: row.id,
    projectId: input.projectId,
    summary: `${input.user.name} 在《${project.title}》新增任務「${input.title}」`,
  })

  return { id: row.id }
}

export async function updateTask(input: {
  taskId: string
  lockRevision: number
  patch: {
    title?: string
    status?: TaskStatusValue
    priority?: TaskPriorityValue
    assigneeId?: string | null
    progress?: number
    dueDate?: string | null
  }
  user: SessionUser
}): Promise<{ lockRevision: number }> {
  const [existing] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      lockRevision: tasks.lockRevision,
    })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)))
    .limit(1)

  if (!existing) throw ApiError.notFound('找不到這個任務')

  /*
   * 版本對不上就拒絕 (Z89).
   *
   * 這是 `lock_revision` 存在的唯一理由。不比對的話，兩個人同時拖同一張卡，
   * 後寫的會安靜地蓋掉先寫的——沒有錯誤、沒有提示，只是有人的修改不見了。
   */
  if (existing.lockRevision !== input.lockRevision) {
    throw ApiError.badRequest(
      '這張卡片在你編輯的時候被改過了。重新整理看一下最新狀態再改一次。'
    )
  }

  const next = existing.lockRevision + 1
  const due =
    input.patch.dueDate === null
      ? null
      : input.patch.dueDate
        ? new Date(input.patch.dueDate)
        : undefined

  await db
    .update(tasks)
    .set({
      ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
      ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
      ...(input.patch.priority !== undefined ? { priority: input.patch.priority } : {}),
      ...(input.patch.assigneeId !== undefined ? { assigneeId: input.patch.assigneeId } : {}),
      ...(input.patch.progress !== undefined ? { progress: input.patch.progress } : {}),
      ...(due !== undefined ? { dueDate: due && !Number.isNaN(due.getTime()) ? due : null } : {}),
      // 完成的時間要記下來，不然「什麼時候做完的」答不出來。
      ...(input.patch.status === 'DONE' && existing.status !== 'DONE'
        ? { completedAt: new Date() }
        : {}),
      ...(input.patch.status && input.patch.status !== 'DONE' ? { completedAt: null } : {}),
      lockRevision: next,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId))

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'task',
    entityId: input.taskId,
    projectId: existing.projectId,
    summary:
      input.patch.status && input.patch.status !== existing.status
        ? `${input.user.name} 把任務「${existing.title}」移到 ${input.patch.status}`
        : `${input.user.name} 更新了任務「${existing.title}」`,
  })

  return { lockRevision: next }
}
