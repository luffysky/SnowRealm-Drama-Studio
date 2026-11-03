import { FileText, PenLine } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EmptyState } from '@/components/ui/StateViews'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { novelIndex } from '@/lib/writing'
import { cn, formatRelativeZh } from '@/lib/utils'

export const metadata: Metadata = { title: '小說編輯' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * Project-level novel index (spec v3 §11.1「作品級 /novel 是索引入口」).
 *
 * Deliberately not an editor: the prose lives in one place, per episode, at
 * `/episodes/[episodeId]/novel`. This page only says which episodes have been
 * written and sends you there — 「不得造成兩份正文」.
 */
export default async function NovelIndexPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const rows = await novelIndex(project.id)

  const written = rows.filter((row) => row.charCount > 0)
  const totalChars = rows.reduce((n, row) => n + row.charCount, 0)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <PenLine aria-hidden className="size-4 text-accent-400" />
          小說編輯
        </h2>
        <p className="text-[11px] text-ink-500">
          共 {rows.length} 集・已動筆 {written.length} 集・總字數{' '}
          {totalChars.toLocaleString('en-US')} 字
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="尚未建立集數"
          description="小說是以集為單位撰寫的。先在「集數管理」建立集數，再回來動筆。"
          icon={<FileText aria-hidden className="size-5 text-ink-500" />}
          className="py-20"
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((row) => (
            <li key={row.episodeId}>
              <Link
                href={`/projects/${project.id}/episodes/${row.episodeId}/novel`}
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
                      row.charCount > 0
                        ? 'bg-emerald-950 text-emerald-300 ring-emerald-800'
                        : 'bg-stage-800 text-ink-500 ring-stage-700'
                    )}
                  >
                    {row.charCount > 0 ? '已動筆' : '未開始'}
                  </span>
                </div>

                <p className="text-[10px] text-ink-600 tabular-nums">
                  {row.chapterCount} 章・{row.charCount.toLocaleString('en-US')} 字
                  {row.updatedAt && row.charCount > 0 && (
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
