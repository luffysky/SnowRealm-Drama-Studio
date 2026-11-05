'use client'

import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_STYLE,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  type TaskPriorityValue,
  type TaskStatusValue,
} from '@/lib/constants'
import { cn, formatRelativeZh } from '@/lib/utils'

/**
 * 跨作品任務 (Z89).
 *
 * `tasks` 這張表一筆都沒有，所以這一頁跟成本中心、團隊管理不一樣：沒有
 * 「建立」的話它會永遠是空的。
 *
 * ## 樂觀鎖真的在用
 *
 * 每張卡片都帶著 `lockRevision` 送出去。對不上就被伺服器擋下來並要求重新
 * 整理——那正是 schema 裡那個欄位的用途：兩個人同時改同一張卡，後寫的不該
 * 安靜地蓋掉先寫的。
 *
 * 不做拖拉：拖拉要處理 sortOrder 的重排、樂觀更新與回滾，而這三件事加起來
 * 比「下拉選狀態」多十倍的出錯面，卻只省一個手勢。先把會動的做對。
 */

type Task = {
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
  dueDate: string | null
  lockRevision: number
}

type Column = { status: TaskStatusValue; tasks: Task[] }

export function TaskBoard({
  columns,
  projects,
  members,
  overdue,
  total,
  canWrite,
}: {
  columns: Column[]
  projects: { id: string; title: string }[]
  members: { id: string; name: string }[]
  overdue: number
  total: number
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<TaskPriorityValue>('NORMAL')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !title.trim() || !projectId) return

    setBusy('new')
    try {
      const response = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          priority,
          ...(assigneeId ? { assigneeId } : {}),
          ...(dueDate ? { dueDate } : {}),
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('加好了', title.trim())
      setTitle('')
      setDueDate('')
      setOpen(false)
      router.refresh()
    } catch (cause) {
      toast.error('加不進去', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function move(task: Task, status: TaskStatusValue) {
    if (busy || status === task.status) return

    setBusy(task.id)
    try {
      const response = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // 帶上版本。對不上伺服器會擋，而那正是這個欄位存在的理由。
        body: JSON.stringify({ status, lockRevision: task.lockRevision }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      router.refresh()
    } catch (cause) {
      toast.error('移不過去', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-ink-500">
          共 {total} 件
          {overdue > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-400">
              <AlertTriangle aria-hidden className="size-3" />
              {overdue} 件過期未完成
            </span>
          )}
        </span>

        {canWrite && projects.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="tap ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-[11px] text-white transition-colors hover:bg-accent-500"
          >
            <Plus aria-hidden className="size-3.5" />
            新增任務
          </button>
        )}
      </div>

      {open && canWrite && (
        <form
          onSubmit={(event) => void create(event)}
          className="flex flex-col gap-2 rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700/60"
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="要做什麼？"
            maxLength={200}
            required
            className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />

          <div className="grid gap-2 sm:grid-cols-4">
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>

            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriorityValue)}
              className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              {TASK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {TASK_PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>

            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              <option value="">沒有指派</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="h-8 rounded-lg bg-stage-850 px-2 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={busy === 'new' || !title.trim()}
              className="tap inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-[11px] text-white transition-colors hover:bg-accent-500 disabled:opacity-40"
            >
              {busy === 'new' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              加進去
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="tap rounded-lg px-3 py-1.5 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-2 lg:grid-cols-5">
        {columns.map((column) => (
          <section key={column.status} className="flex flex-col gap-1.5">
            <h3 className="flex items-baseline gap-1.5 text-[11px] font-medium text-ink-300">
              {TASK_STATUS_LABEL[column.status]}
              <span className="text-[10px] tabular-nums text-ink-700">
                {column.tasks.length}
              </span>
            </h3>

            {column.tasks.length === 0 ? (
              <p className="rounded-lg bg-stage-900/50 px-2 py-3 text-center text-[10px] text-ink-700 ring-1 ring-stage-800">
                空的
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {column.tasks.map((task) => {
                  const late =
                    task.status !== 'DONE' &&
                    task.dueDate &&
                    new Date(task.dueDate).getTime() < Date.now()

                  return (
                    <li
                      key={task.id}
                      className="flex flex-col gap-1 rounded-lg bg-stage-900 p-2.5 ring-1 ring-stage-700/60"
                    >
                      <span className="text-[11px] leading-snug text-ink-100">{task.title}</span>

                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-600">
                        <span className="truncate">{task.projectTitle}</span>
                        {task.episodeNumber !== null && (
                          <span className="font-mono">
                            EP{String(task.episodeNumber).padStart(3, '0')}
                          </span>
                        )}
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[9px]',
                            TASK_PRIORITY_STYLE[task.priority]
                          )}
                        >
                          {TASK_PRIORITY_LABEL[task.priority]}
                        </span>
                      </p>

                      <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-ink-700">
                        <span>{task.assigneeName ?? '沒有指派'}</span>
                        {task.dueDate && (
                          <span className={cn(late && 'text-amber-400')}>
                            {late ? '已過期 ' : ''}
                            {formatRelativeZh(new Date(task.dueDate))}
                          </span>
                        )}
                      </p>

                      {canWrite && (
                        <select
                          value={task.status}
                          disabled={busy === task.id}
                          onChange={(event) =>
                            void move(task, event.target.value as TaskStatusValue)
                          }
                          className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-40"
                        >
                          {TASK_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {TASK_STATUS_LABEL[value]}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
