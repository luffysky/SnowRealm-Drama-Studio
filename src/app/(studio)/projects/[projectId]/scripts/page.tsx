import { Clapperboard, FileText } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EmptyState } from '@/components/ui/StateViews'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { novelIndex } from '@/lib/writing'
import { cn, formatDurationZh, formatRelativeZh } from '@/lib/utils'

export const metadata: Metadata = { title: '劇本工坊' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 劇本工坊 — the project-level index of scripts.
 *
 * Like `/novel`, this lists rather than edits: each episode's script lives at
 * `/episodes/[episodeId]/script`, so there is one copy of every scene.
 */
export default async function ScriptsIndexPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const rows = await novelIndex(project.id, 'SCRIPT')

  const started = rows.filter((row) => row.sceneCount > 0)
  const totalScenes = rows.reduce((n, row) => n + row.sceneCount, 0)
  const totalSeconds = rows.reduce((n, row) => n + row.estimatedSec, 0)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Clapperboard aria-hidden className="size-4 text-accent-400" />
          劇本工坊
        </h2>
        <p className="text-[11px] text-ink-500">
          共 {rows.length} 集・已開工 {started.length} 集・{totalScenes} 場
          {totalSeconds > 0 && `・累計約 ${formatDurationZh(totalSeconds)}`}
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="尚未建立集數"
          description="劇本是以集為單位撰寫的。先在「集數管理」建立集數。"
          icon={<FileText aria-hidden className="size-5 text-ink-500" />}
          className="py-20"
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((row) => (
            <li key={row.episodeId}>
              <Link
                href={`/projects/${project.id}/episodes/${row.episodeId}/script`}
                className="panel flex h-full flex-col gap-1.5 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700 transition-all hover:ring-stage-600"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-ink-300 tabular-nums">
                    EP{String(row.number).padStart(3, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                    {row.title || <span className="text-ink-600">未命名</span>}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
                      row.sceneCount > 0
                        ? 'bg-emerald-950 text-emerald-300 ring-emerald-800'
                        : 'bg-stage-800 text-ink-500 ring-stage-700'
                    )}
                  >
                    {row.sceneCount > 0 ? `${row.sceneCount} 場` : '未開工'}
                  </span>
                </div>

                <p className="text-[10px] text-ink-600 tabular-nums">
                  {row.charCount.toLocaleString('en-US')} 字
                  {row.estimatedSec > 0 && `・約 ${formatDurationZh(row.estimatedSec)}`}
                  {row.updatedAt && row.sceneCount > 0 && (
                    <>
                      ・{formatRelativeZh(row.updatedAt)}
                      {row.lastEditorName && `・${row.lastEditorName}`}
                    </>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
