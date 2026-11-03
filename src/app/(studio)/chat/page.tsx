import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ChatRoom } from '@/components/chat/ChatRoom'
import { getSessionUser } from '@/lib/auth/session'
import { listMessages, openDirectConversation } from '@/lib/chat'
import { listProjects } from '@/lib/projects'

export const metadata: Metadata = { title: '訊息' }
/** The thread changes constantly; a cached render would open on stale history. */
export const dynamic = 'force-dynamic'

/**
 * 即時對話 (Z99).
 *
 * The first page of history renders on the server so the thread is readable
 * before any JavaScript runs; the live channel takes over from there.
 */
export default async function ChatPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const conversationId = await openDirectConversation(user.id)

  const [messages, projects] = await Promise.all([
    listMessages({ conversationId, limit: 40 }),
    listProjects(user.id),
  ])

  /*
   * Attachments need a project to live under, because `assets.project_id` is
   * NOT NULL and every permission check in the storage layer flows through it.
   * The flagship, or the most recent — chat files are studio-wide in spirit,
   * and inventing a nullable scope for them would open a hole in those checks.
   */
  const uploadProjectId =
    projects.cards.find((card) => card.isFlagship)?.id ?? projects.cards[0]?.id ?? null

  /*
   * No page header. `ChatRoom` has its own — who you are talking to, whether
   * they are online — and stacking a second one above it pushed the composer
   * off the bottom of the viewport. A conversation is one full-height surface.
   */
  return (
    <ChatRoom
      conversationId={conversationId}
      meId={user.id}
      uploadProjectId={uploadProjectId}
      initialMessages={messages.map((message) => ({
        ...message,
        recalledAt: message.recalledAt?.toISOString() ?? null,
        editedAt: message.editedAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
      }))}
      initialSeq={messages[messages.length - 1]?.seq ?? 0}
    />
  )
}
