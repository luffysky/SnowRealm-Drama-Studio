import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CharacterBrowser } from '@/components/studio/CharacterBrowser'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { getCharacters } from '@/lib/characters'
import { requireProjectPage } from '@/lib/project-access'

export const metadata: Metadata = { title: '角色設定' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 10 角色資料庫 / 11 角色詳情.
 *
 * One page rather than two: the pair work through a cast by comparing — who is
 * a lead, who already has a locked look, who has no voice yet — and a separate
 * page per character would turn that into a dozen round-trips.
 */
export default async function CharactersPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const data = await getCharacters(project.id)

  return (
    <CharacterBrowser
      projectId={project.id}
      characters={data.characters.map((character) => ({
        ...character,
        updatedAt: character.updatedAt.toISOString(),
      }))}
      relationships={data.relationships}
      countsByTier={data.countsByTier}
      total={data.total}
      canWrite={can(user, 'character.write')}
    />
  )
}
