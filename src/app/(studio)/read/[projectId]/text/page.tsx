import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { NovelReader } from '@/components/studio/NovelReader'
import { getSessionUser } from '@/lib/auth/session'
import { getCharacters } from '@/lib/characters'
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
 * Its own route rather than a tab on the book page (Z136): the reader is a
 * `fixed inset-0` overlay, so it would paint over any tab strip above it.
 * Reading is also the one thing that deserves the whole screen — and the way
 * back is the 退出 button, which now returns to the book page rather than to
 * the shelf.
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

  const [chapters, characters] = await Promise.all([
    novelForReading(project.id),
    getCharacters(project.id),
  ])
  if (chapters.length === 0) notFound()

  /*
   * Only what 分角色朗讀 needs. Sending the whole character record to the
   * browser would ship every background note and prompt into a page whose job
   * is to read the prose.
   */
  const cast = characters.characters.map((character) => ({
    id: character.id,
    name: character.name,
    alias: character.alias,
    gender: character.gender,
    tier: character.tier,
    voiceId: character.voiceId,
  }))

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
      exitHref={`/read/${project.id}`}
      /*
       * The cast, for 分角色朗讀 (Z111). Names only — attribution matches
       * against names this work actually has, which is what keeps a stray
       * 「他說」 from being handed somebody's voice.
       */
      cast={cast}
    />
  )
}
