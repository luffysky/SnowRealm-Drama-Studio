import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { DramaTheatre } from '@/components/studio/DramaTheatre'
import { getSessionUser } from '@/lib/auth/session'
import { listDramaEpisodes } from '@/lib/library'
import { requireProjectPage } from '@/lib/project-access'
import { dramaTitleOf } from '@/lib/project-titles'

type Params = { params: Promise<{ projectId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await getSessionUser()
  if (!user) return { title: '影片播放' }

  const { projectId } = await params
  try {
    const project = await requireProjectPage(projectId, user.id)
    return { title: dramaTitleOf(project) }
  } catch {
    return { title: '影片播放' }
  }
}

/** 短劇播放 — one work, its finished cuts, in order. */
export default async function WatchDramaPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const episodes = await listDramaEpisodes(project.id)
  if (episodes.length === 0) notFound()

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href="/watch"
          className="inline-flex items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          片單
        </Link>
        <h2 className="text-sm font-semibold text-ink-100">{dramaTitleOf(project)}</h2>
        <span className="text-[11px] text-ink-600">{episodes.length} 集</span>
      </header>

      {/*
        `useSearchParams` needs a Suspense boundary, or the whole route opts
        out of static rendering at build time.
      */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-stage-900" />}>
        <DramaTheatre
          episodes={episodes.map((episode) => ({
            episodeId: episode.episodeId,
            number: episode.number,
            title: episode.title,
            logline: episode.logline,
            assetId: episode.assetId,
            durationSec: episode.durationSec,
            hasPoster: episode.hasPoster,
          }))}
        />
      </Suspense>
    </div>
  )
}
