import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AssistantWorkspace } from '@/components/assistant/AssistantWorkspace'
import { getSessionUser } from '@/lib/auth/session'
import { assertOwnThread, listThreads, openThread } from '@/lib/assistant/threads'
import { listMessages } from '@/lib/chat'

export const metadata: Metadata = { title: 'AI 助理' }
/** The thread changes as you use it; a cached render opens on stale history. */
export const dynamic = 'force-dynamic'

/**
 * AI 助理 (Z100).
 *
 * Its own page, with its own threads, separate from 「訊息」. The assistant
 * used to be summoned into the two-person conversation with `@助理`, which put
 * a question to a model in the middle of two people talking to each other —
 * and made its context their context.
 *
 * `?t=<id>` opens a particular thread, so a thread is linkable and survives a
 * reload. An id that is not yours falls back to your own newest rather than
 * raising: a stale bookmark should open the assistant, not an error page.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { t } = await searchParams

  let threadId: string | null = null
  if (t) {
    try {
      await assertOwnThread(t, user.id)
      threadId = t
    } catch {
      threadId = null
    }
  }

  threadId ??= await openThread(user.id)

  const [threads, messages] = await Promise.all([
    listThreads(user.id),
    listMessages({ conversationId: threadId, limit: 40 }),
  ])

  /*
   * No page header. The workspace has its own — which thread, the help panel,
   * 新對話 — and a second one above it pushes the composer off the bottom of
   * the viewport, which is the bug the chat page hit first.
   */
  return (
    <AssistantWorkspace
      meId={user.id}
      myName={user.name}
      myColor={user.color}
      initialThreadId={threadId}
      initialThreads={threads.map((thread) => ({
        ...thread,
        updatedAt: thread.updatedAt.toISOString(),
      }))}
      initialMessages={messages.map((message) => ({
        ...message,
        recalledAt: message.recalledAt?.toISOString() ?? null,
        editedAt: message.editedAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
      }))}
    />
  )
}
