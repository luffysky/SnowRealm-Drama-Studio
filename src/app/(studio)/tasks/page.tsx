import { ListChecks } from 'lucide-react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { TaskBoard } from '@/components/studio/TaskBoard'
import { EmptyState } from '@/components/ui/StateViews'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { taskBoard } from '@/lib/tasks'

export const metadata: Metadata = { title: '跨作品任務' }

/**
 * 跨作品任務 (Z89).
 *
 * 側邊欄上掛著這一項、標著 M3，而這個畫面從來沒有做出來——`tasks` 那張表
 * 一筆都沒有。
 *
 * **跨作品是這一頁存在的理由**（`docs/ROUTES.md` §1）：一部作品裡的進度在
 * 那部作品自己的「製作流程」看，而「這週誰該做什麼」是跨作品的問題。
 */
export default async function TasksPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const board = await taskBoard(user.id)
  const canWrite = can(user, 'task.write')

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <ListChecks aria-hidden className="size-4 text-accent-400" />
          跨作品任務
        </h2>
        <p className="text-[11px] text-ink-500">
          所有作品的待辦放在一起。單一作品的進度在那部作品的「製作流程」看。
        </p>
      </header>

      {board.total === 0 && !canWrite ? (
        <EmptyState
          title="還沒有任何任務"
          description="你沒有新增任務的權限，所以這裡暫時是空的。"
        />
      ) : (
        <TaskBoard
          columns={board.columns.map((column) => ({
            status: column.status,
            tasks: column.tasks.map((task) => ({
              ...task,
              // 伺服器元件傳到用戶端要可序列化，Date 不是。
              dueDate: task.dueDate ? task.dueDate.toISOString() : null,
            })),
          }))}
          projects={board.projects}
          members={board.members}
          overdue={board.overdue}
          total={board.total}
          canWrite={canWrite}
        />
      )}
    </div>
  )
}
