import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ScriptEditor } from '@/components/studio/ScriptEditor'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { adapterForTask, novelSources } from '@/lib/ai/jobs'
import { getEditorModules, getFxRates } from '@/lib/settings'
import { openDocument } from '@/lib/writing'

export const metadata: Metadata = { title: '劇本編輯器' }

type Params = {
  params: Promise<{ projectId: string; episodeId: string }>
  /** `?scene=<id>` — a search result opening the scene it matched. */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * 07 劇本編輯器 — one episode's script, scene by scene.
 *
 * The runtime window comes from the project rather than a constant: 120–180
 * seconds is this show's setting, not a property of the software.
 */
export default async function EpisodeScriptPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, episodeId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const requestedScene = (await searchParams).scene
  const sceneId = typeof requestedScene === 'string' ? requestedScene : null

  const [document, modules, settings, fx, provider, sources] = await Promise.all([
    openDocument(project.id, episodeId, 'SCRIPT'),
    getEditorModules('SCRIPT'),
    db
      .select({ min: projects.targetMinSec, max: projects.targetMaxSec })
      .from(projects)
      .where(eq(projects.id, project.id))
      .limit(1),
    getFxRates(),
    providerStatus(),
    /*
     * Which episodes have a novel worth adapting (Z113).
     *
     * The list, not the prose. The text itself is read server-side when the
     * job runs — an episode is ten thousand characters, and embedding it in
     * this page just to post it back was a round trip for nothing.
     *
     * Before any of this the task was handed the current *scene*, so the
     * model was asked to adapt a novel it had never been shown and correctly
     * refused rather than inventing one.
     */
    novelSources(project.id),
  ])

  if (!document) notFound()

  return (
    <ScriptEditor
      projectId={project.id}
      documentId={document.id}
      episodeId={document.episodeId}
      episodeNumber={document.episodeNumber}
      episodeTitle={document.episodeTitle}
      initialScenes={document.scenes.map((scene) => ({
        ...scene,
        updatedAt: scene.updatedAt.toISOString(),
      }))}
      initialSceneId={sceneId}
      novelSources={sources}
      initialRevision={document.lockRevision}
      lastEditorName={document.lastEditorName}
      targetMinSec={settings[0]?.min ?? 120}
      targetMaxSec={settings[0]?.max ?? 180}
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
    const resolved = await adapterForTask('NOVEL_TO_SCRIPT', null)
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
