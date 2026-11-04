import { Headphones } from 'lucide-react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { MusicPlayer } from '@/components/studio/MusicPlayer'
import { EmptyState } from '@/components/ui/StateViews'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { listTracks } from '@/lib/library'

export const metadata: Metadata = { title: '音樂播放' }

/**
 * 音樂播放 — every finished track in the studio, with a queue.
 *
 * Cross-project: the music library inside a work is for managing one work's
 * audio, and this is for listening to all of it. Tracks whose upload never
 * completed are not here — a player that cannot play is worse than a short
 * list.
 */
export default async function ListenPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const tracks = await listTracks(user.id)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Headphones aria-hidden className="size-4 text-accent-400" />
          音樂播放
        </h2>
        <p className="text-[11px] text-ink-500">
          {tracks.length > 0 ? `${tracks.length} 首・跨作品` : '上傳完成的音樂會出現在這裡'}
        </p>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          title="還沒有可以播的音樂"
          description="在作品的素材資產中心新增音樂，這裡就會出現。"
          icon={<Headphones aria-hidden className="size-5 text-ink-500" />}
          className="py-24"
        />
      ) : (
        <MusicPlayer
          canEditLyrics={can(user, 'asset.write')}
          tracks={tracks.map((track) => ({
            assetId: track.assetId,
            projectId: track.projectId,
            projectTitle: track.projectTitle,
            title: track.title,
            name: track.name,
            artist: track.artist,
            category: track.category,
            durationSec: track.durationSec,
            licenseStatus: track.licenseStatus,
          }))}
        />
      )}
    </div>
  )
}
