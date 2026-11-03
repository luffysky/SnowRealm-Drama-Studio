import { Download, Music, Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { WaveformPlayer } from '@/components/assets/WaveformPlayer'
import { assetDownloadUrl } from '@/lib/asset-url'
import { getSessionUser } from '@/lib/auth/session'
import { getMusic } from '@/lib/music'
import { LICENSE_LABEL, LICENSE_STYLE, MUSIC_CATEGORY_LABEL } from '@/lib/music-view'
import { requireProjectPage } from '@/lib/project-access'
import { cn, formatDurationZh } from '@/lib/utils'

export const metadata: Metadata = { title: '音樂播放與波形' }

type Params = { params: Promise<{ projectId: string; assetId: string }> }

/**
 * 83 音訊播放與波形 (Z7).
 *
 * Covers the player and the facts about the track. The reference art also
 * shows 片段標記, 版本管理, 授權與來源 and 使用關聯 on this page; those are
 * Z9 / Z8 / Z12 and are linked from the footer note rather than stubbed here,
 * because a tab that opens an empty panel reads as a broken feature while a
 * sentence reads as a roadmap.
 */
export default async function MusicDetailPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, assetId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const track = await getMusic(project.id, assetId)
  if (!track) notFound()

  const title = track.title || track.name

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Music aria-hidden className="size-4 text-accent-400" />
          {title}
        </h2>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] ring-1',
            LICENSE_STYLE[track.licenseStatus] ?? LICENSE_STYLE.PENDING_REVIEW
          )}
        >
          {LICENSE_LABEL[track.licenseStatus] ?? track.licenseStatus}
        </span>
        <Link
          href={`/projects/${project.id}/assets/music`}
          className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
        >
          返回音樂素材庫
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/projects/${project.id}/assets/music/${track.assetId}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-200 transition-colors hover:bg-stage-700"
          >
            <Pencil aria-hidden className="size-3.5" />
            編輯資訊
          </Link>
          {/*
            A plain anchor, not a Link: this leaves the app to a presigned URL,
            and the router would try to treat the redirect as a navigation.
          */}
          <a
            href={assetDownloadUrl(track.assetId)}
            className="inline-flex items-center gap-1.5 rounded-md bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-200 transition-colors hover:bg-stage-700"
          >
            <Download aria-hidden className="size-3.5" />
            下載原檔
          </a>
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <WaveformPlayer
            assetId={track.assetId}
            durationSec={track.durationSec ?? null}
            mimeType={track.mimeType}
          />

          {track.description && (
            <section className="panel rounded-xl bg-stage-900 p-4 ring-1 ring-stage-700">
              <h3 className="mb-1.5 text-xs font-medium text-ink-200">說明</h3>
              <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink-400">
                {track.description}
              </p>
            </section>
          )}
        </div>

        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="border-b border-stage-700/60 px-4 py-2.5">
            <h3 className="text-xs font-medium text-ink-200">基本資訊</h3>
          </header>

          <dl className="flex flex-col divide-y divide-stage-700/40">
            <Row label="音樂名稱" value={title} />
            <Row label="音樂類型" value={MUSIC_CATEGORY_LABEL[track.category] ?? track.category} />
            <Row
              label="時長"
              value={track.durationSec ? formatDurationZh(Math.floor(track.durationSec)) : '—'}
            />
            <Row label="檔案格式" value={track.mimeType || '—'} />
            <Row label="檔案大小" value={formatBytes(track.sizeBytes)} />
            <Row label="版本" value={`v${track.version}`} />
            <Row label="演出／製作" value={track.artist || '—'} />
            <Row label="語言" value={track.language || '—'} />
            <Row label="BPM" value={track.bpm === null ? '—' : String(track.bpm)} />
            <Row label="調性" value={track.musicalKey || '—'} />
            <Row label="風格標籤" value={track.genreTags.join('、') || '—'} />
            <Row label="情緒標籤" value={track.moodTags.join('、') || '—'} />
            <Row label="創作來源" value={track.sourcePlatform || '—'} />
            <Row label="原始檔名" value={track.name} />
            <Row
              label="波形資料"
              value={track.hasWaveform ? '已產生' : '無（用內建播放器）'}
            />
          </dl>

          <p className="border-t border-stage-700/60 px-4 py-3 text-[10px] leading-relaxed text-ink-700">
            片段標記、版本管理、授權與來源、使用關聯還沒做（Z8／Z9／Z12）。
            這裡只顯示資料庫裡真的有的欄位。
          </p>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2">
      <dt className="shrink-0 text-[10px] text-ink-600">{label}</dt>
      <dd className="ml-auto min-w-0 text-right text-[11px] break-words text-ink-200">
        {value}
      </dd>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
