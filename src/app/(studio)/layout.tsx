import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { StudioShell } from '@/components/studio/StudioShell'

/**
 * Guards every workbench route. The check runs server-side on each request, so
 * an expired or revoked session cannot render the shell at all.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return <StudioShell user={user}>{children}</StudioShell>
}
