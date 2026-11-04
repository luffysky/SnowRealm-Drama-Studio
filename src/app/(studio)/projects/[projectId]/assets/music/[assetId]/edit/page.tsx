import { Music } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { MusicForm } from '@/components/assets/MusicForm'
import { getSessionUser } from '@/lib/auth/session'
import { getMusic } from '@/lib/music'
import { requireProjectPage } from '@/lib/project-access'
import { usedMusicTags } from '@/lib/music-tags-db'

export const metadata: Metadata = { title: '編輯音樂' }

type Params = { params: Promise<{ projectId: string; assetId: string }> }

/** 84 音樂編輯 (Z6). */
export default async function EditMusicPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, assetId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [track, usedTags] = await Promise.all([
    getMusic(project.id, assetId),
    // 這個作品已經用過的標籤，跟預設的一起列出來給人按 (Z119)。
    usedMusicTags(project.id),
  ])
  if (!track) notFound()

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Music aria-hidden className="size-4 text-accent-400" />
          編輯音樂
        </h2>
        <Link
          href={`/projects/${project.id}/assets`}
          className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          返回素材資產中心
        </Link>
      </header>

      <MusicForm
        projectId={project.id}
        mode="edit"
        usedTags={usedTags}
        assetId={track.assetId}
        initial={{
          title: track.title || track.name,
          category: track.category,
          genreTags: track.genreTags,
          moodTags: track.moodTags,
          language: track.language,
          artist: track.artist,
          bpm: track.bpm,
          musicalKey: track.musicalKey,
          sourcePlatform: track.sourcePlatform,
          description: track.description,
        }}
        fileInfo={{
          name: track.name,
          sizeBytes: track.sizeBytes,
          durationSec: track.durationSec ?? null,
          hasWaveform: track.hasWaveform,
        }}
      />
    </div>
  )
}
