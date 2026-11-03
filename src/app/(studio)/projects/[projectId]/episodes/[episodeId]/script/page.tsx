import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ScriptEditor } from '@/components/studio/ScriptEditor'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { adapterForTask } from '@/lib/ai/jobs'
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

  const [document, modules, settings, fx, provider, novelText] = await Promise.all([
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
     * The episode's novel, for 依小說生成劇本.
     *
     * That task used to be handed the current *scene* — so the model was
     * asked to adapt a novel it had never been shown, and correctly refused
     * rather than inventing one.
     */
    episodeNovelText(episodeId),
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
      novelText={novelText}
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

/** All of this episode's novel prose, in chapter order. */
async function episodeNovelText(episodeId: string): Promise<string> {
  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { and, asc, eq, isNull } = await import('drizzle-orm')
  const { stripHtmlToText } = await import('@/lib/utils')

  const rows = await db
    .select({ title: schema.chapters.title, content: schema.chapters.content })
    .from(schema.chapters)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.chapters.documentId))
    .where(
      and(
        eq(schema.documents.episodeId, episodeId),
        eq(schema.documents.kind, 'NOVEL'),
        isNull(schema.documents.deletedAt)
      )
    )
    .orderBy(asc(schema.chapters.sortOrder))

  return rows
    .map((row) => [row.title, stripHtmlToText(row.content)].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim()
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
