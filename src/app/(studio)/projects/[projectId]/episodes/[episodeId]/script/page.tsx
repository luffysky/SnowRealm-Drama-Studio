import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ScriptEditor } from '@/components/studio/ScriptEditor'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { getEditorModules } from '@/lib/settings'
import { openDocument } from '@/lib/writing'

export const metadata: Metadata = { title: '劇本編輯器' }

type Params = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 07 劇本編輯器 — one episode's script, scene by scene.
 *
 * The runtime window comes from the project rather than a constant: 120–180
 * seconds is this show's setting, not a property of the software.
 */
export default async function EpisodeScriptPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, episodeId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [document, modules, settings] = await Promise.all([
    openDocument(project.id, episodeId, 'SCRIPT'),
    getEditorModules('SCRIPT'),
    db
      .select({ min: projects.targetMinSec, max: projects.targetMaxSec })
      .from(projects)
      .where(eq(projects.id, project.id))
      .limit(1),
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
      initialRevision={document.lockRevision}
      lastEditorName={document.lastEditorName}
      targetMinSec={settings[0]?.min ?? 120}
      targetMaxSec={settings[0]?.max ?? 180}
      modules={modules}
    />
  )
}
