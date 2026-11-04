import { Music } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MusicForm } from '@/components/assets/MusicForm'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { usedMusicTags } from '@/lib/music-tags-db'

export const metadata: Metadata = { title: '新增音樂' }

type Params = { params: Promise<{ projectId: string }> }

/** 84 音樂新增 (Z6). */
export default async function NewMusicPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)
  // 這個作品已經用過的標籤，跟預設的一起列出來給人按 (Z119)。
  const usedTags = await usedMusicTags(project.id)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Music aria-hidden className="size-4 text-accent-400" />
          新增音樂
        </h2>
        <Link
          href={`/projects/${project.id}/assets`}
          className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          返回素材資產中心
        </Link>
      </header>

      <MusicForm projectId={project.id} mode="create" usedTags={usedTags} />
    </div>
  )
}
