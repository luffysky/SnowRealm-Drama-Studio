import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { NovelReader } from '@/components/studio/NovelReader'
import { getSessionUser } from '@/lib/auth/session'
import { novelForReading } from '@/lib/novel-export'
import { requireProjectPage } from '@/lib/project-access'
import { novelTitleOf } from '@/lib/project-titles'

type Params = {
  params: Promise<{ projectId: string }>
  /** `?chapter=` — opening a particular chapter, from the editor or a link. */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await getSessionUser()
  if (!user) return { title: '看小說' }

  const { projectId } = await params
  try {
    const project = await requireProjectPage(projectId, user.id)
    return { title: novelTitleOf(project) }
  } catch {
    return { title: '看小說' }
  }
}

/**
 * 小說閱讀器 — one book, read straight through.
 *
 * The prose is flattened to paragraphs on the server rather than shipped as
 * the editor's HTML: the reader applies its own typography, and injecting
 * stored markup here would mean trusting it in a context with none of the
 * editor's sanitising.
 */
export default async function ReadNovelPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const chapters = await novelForReading(project.id)
  if (chapters.length === 0) notFound()

  const requested = (await searchParams).chapter
  const chapterId = typeof requested === 'string' ? requested : undefined

  /*
   * No surrounding chrome. The reader covers the viewport, so the breadcrumb
   * that used to sit above it would be painted over — the way back out is the
   * 退出 button inside the reader itself.
   */
  return (
    <NovelReader
      bookTitle={novelTitleOf(project)}
      chapters={chapters}
      initialChapterId={chapterId}
      exitHref="/read"
    />
  )
}
