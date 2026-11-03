import { BookOpen } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EmptyState } from '@/components/ui/StateViews'
import { assetPreviewUrl } from '@/lib/asset-url'
import { getSessionUser } from '@/lib/auth/session'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE } from '@/lib/constants'
import { listNovels } from '@/lib/library'
import { novelTitleOf } from '@/lib/project-titles'
import { cn, formatRelativeZh } from '@/lib/utils'

export const metadata: Metadata = { title: '看小說' }

/**
 * 小說書架 — the shelf, not the reader.
 *
 * Modelled on how a reading site actually opens: a wall of covers, each with
 * the title, how long the book is and where you left it, and the reader behind
 * one click. The reader itself is `/read/[projectId]`.
 *
 * Cross-project, which is why it is in the global rail. A work with no prose
 * is not on the shelf at all — a cover that opens onto nothing is worse than
 * an absence.
 */
export default async function ShelfPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const novels = await listNovels(user.id)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <BookOpen aria-hidden className="size-4 text-accent-400" />
          書架
        </h2>
        <p className="text-[11px] text-ink-500">
          {novels.length > 0 ? `${novels.length} 本・點封面開始讀` : '工作室寫完的小說會出現在這裡'}
        </p>
      </header>

      {novels.length === 0 ? (
        <EmptyState
          title="書架還是空的"
          description="在作品的「小說編輯」寫下第一章，這裡就會出現那本書。"
          icon={<BookOpen aria-hidden className="size-5 text-ink-500" />}
          className="py-24"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {novels.map((novel) => {
            // The novel cover when there is one, the work's key art otherwise
            // — same fallback as the title, and for the same reason: an empty
            // field means "use the work's", never a stale copy.
            const cover = novel.novelCoverAssetId ?? novel.coverAssetId

            return (
              <li key={novel.projectId}>
                <Link
                  href={`/read/${novel.projectId}`}
                  className="panel group flex h-full flex-col overflow-hidden rounded-xl bg-stage-900 ring-1 ring-stage-700 transition-all hover:ring-accent-500/50"
                >
                  {/* 2:3 is the proportion of a book cover, not of a poster. */}
                  <div className="relative aspect-2/3 overflow-hidden bg-stage-950">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={assetPreviewUrl(cover)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="art-placeholder grid size-full place-items-center"
                      >
                        <BookOpen className="size-7 text-ink-700" />
                      </span>
                    )}

                    <span
                      className={cn(
                        'absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] ring-1',
                        PROJECT_STATUS_STYLE[novel.status] ?? 'bg-stage-800 text-ink-400 ring-stage-700'
                      )}
                    >
                      {PROJECT_STATUS_LABEL[novel.status] ?? novel.status}
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                    <p className="truncate text-sm font-medium text-ink-50">
                      {novelTitleOf(novel)}
                    </p>
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-500">
                      {novel.synopsis || '尚未撰寫簡介'}
                    </p>

                    <p className="mt-auto flex flex-wrap items-center gap-x-2 pt-1.5 text-[10px] text-ink-600">
                      <span className="tabular-nums">{novel.charCount.toLocaleString('en-US')} 字</span>
                      <span>・</span>
                      <span className="tabular-nums">{novel.chapterCount} 章</span>
                      {novel.updatedAt && (
                        <>
                          <span>・</span>
                          <span>{formatRelativeZh(new Date(novel.updatedAt))}更新</span>
                        </>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
