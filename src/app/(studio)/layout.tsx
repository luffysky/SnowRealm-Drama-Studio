import { redirect } from 'next/navigation'
import { FloatingChat } from '@/components/chat/FloatingChat'
import { getSessionUser } from '@/lib/auth/session'
import { StudioShell } from '@/components/studio/StudioShell'
import { openDirectConversation } from '@/lib/chat'

/**
 * Guards every workbench route. The check runs server-side on each request, so
 * an expired or revoked session cannot render the shell at all.
 *
 * The floating chat is mounted here rather than on the chat page, because an
 * incoming call has to ring wherever you are — when the call panel lived
 * inside the conversation, the phone only rang if you were already looking at
 * it.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const conversationId = await openDirectConversation(user.id)

  return (
    <StudioShell user={user}>
      {children}
      <FloatingChat conversationId={conversationId} meId={user.id} />
    </StudioShell>
  )
}
