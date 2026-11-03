import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { NovelEditor } from '@/components/studio/NovelEditor'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { adapterForTask } from '@/lib/ai/jobs'
import { getEditorModules, getFxRates } from '@/lib/settings'
import { openDocument } from '@/lib/writing'

export const metadata: Metadata = { title: '小說編輯器' }

type Params = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 06 小說編輯器 — one episode's novel.
 *
 * Spec v3 §11.1: the project-level `/novel` page is an index; the prose itself
 * lives here, one document per episode, so there is never a second copy to
 * reconcile.
 */
export default async function EpisodeNovelPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, episodeId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [document, modules, fx, provider] = await Promise.all([
    openDocument(project.id, episodeId, 'NOVEL'),
    getEditorModules('NOVEL'),
    getFxRates(),
    /*
     * Asked on the server, so the panel renders its real state on first
     * paint rather than flashing "available" and correcting itself.
     */
    providerStatus(),
  ])
  if (!document) notFound()

  return (
    <NovelEditor
      projectId={project.id}
      documentId={document.id}
      episodeId={document.episodeId}
      episodeNumber={document.episodeNumber}
      episodeTitle={document.episodeTitle}
      initialChapters={document.chapters.map((chapter) => ({
        ...chapter,
        updatedAt: chapter.updatedAt.toISOString(),
      }))}
      initialRevision={document.lockRevision}
      lastEditorName={document.lastEditorName}
      /* A 120–180 second episode is roughly this much prose. */
      targetChars={4000}
      modules={modules}
      currency={user.displayCurrency}
      fx={fx}
      providerReady={provider.available}
      providerDetail={provider.detail}
    />
  )
}

/** Whether a text provider is configured, and why not when it isn't. */
async function providerStatus(): Promise<{ available: boolean; detail?: string }> {
  try {
    const resolved = await adapterForTask('NOVEL_CONTINUE', null)
    if (!resolved) return { available: false, detail: '尚未設定任何可用的 AI 供應商。' }
    const status = await resolved.adapter.status()
    return { available: status.available, detail: status.detail }
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : undefined,
    }
  }
}
