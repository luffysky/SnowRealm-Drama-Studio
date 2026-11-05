import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { addReviewNote, listReviewNotes } from '@/lib/reviews'
import { reviewNoteSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string }> }

/** 一份文件上的審稿意見 (Z41, design 57). */
export const GET = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('project.read')
  const { projectId } = await context.params
  await requireProjectApi(projectId, user.id)

  const documentId = new URL(request.url).searchParams.get('documentId') ?? ''
  if (!documentId) return jsonOk({ notes: [] })

  const notes = await listReviewNotes(documentId)
  return jsonOk({ notes })
})

export const POST = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('document.write')
  const { projectId } = await context.params
  await requireProjectApi(projectId, user.id)

  const input = await parseJson(request, reviewNoteSchema)

  /*
   * 留意見**不**受定稿鎖限制。
   *
   * 鎖的是內容，不是討論。定稿之後發現問題，第一件該做的事就是留一則意見說
   * 它哪裡有問題——如果連這個都被擋住，那這個鎖就是在逼人繞過它。
   */
  const note = await addReviewNote({
    projectId,
    documentId: input.documentId,
    body: input.body,
    user,
  })

  return jsonOk({ note }, { status: 201 })
})
