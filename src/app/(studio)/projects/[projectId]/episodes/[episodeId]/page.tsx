import { BookOpen, Clapperboard, FileText, GitCompare, Package } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { EpisodeStageBoard } from '@/components/studio/EpisodeStageBoard'
import { EpisodeStatusChip } from '@/components/ui/StatusChip'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { assetPreviewUrl } from '@/lib/asset-url'
import { episodeEditable, getEpisodeDetail } from '@/lib/episodes'
import { requireProjectPage } from '@/lib/project-access'
import { toPercent } from '@/lib/production'

export const metadata: Metadata = { title: '集數詳情' }

type Params = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 13 集數詳情 (Z36, design 05 的「進入集數詳情 →」).
 *
 * spec v3 §11.1 的路由表沒有列這一條，但它寫了「其他舊頁面路由可保留為深層
 * 功能，但必須由相應作品 Tab 進入」——而設計稿 05 的詳情列底部就是那顆按鈕。
 * 所以它是集數管理底下的深層頁，不是第十二個分頁。
 *
 * ## 為什麼需要一個頁面，側欄不夠
 *
 * 側欄要跟列表並排，所以它只能放得下「這一集是什麼」。而**九大階段要能手動
 * 改**、每一段內容要能一鍵跳過去——那需要寬度。
 *
 * 這一頁是一集的樞紐：寫到哪、改到哪、素材在哪、現在卡在哪一個階段。
 */
export default async function EpisodeDetailPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId, episodeId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const [row, editable] = await Promise.all([
    getEpisodeDetail(project.id, episodeId),
    episodeEditable(project.id, episodeId),
  ])

  if (!row || !editable) notFound()

  const canWrite = can(user, 'episode.write')
  const label = `EP${String(row.number).padStart(3, '0')}`

  const links = [
    { href: `/projects/${project.id}/episodes/${episodeId}/novel`, label: '小說', icon: BookOpen },
    {
      href: `/projects/${project.id}/episodes/${episodeId}/script`,
      label: '劇本',
      icon: FileText,
    },
    {
      href: `/projects/${project.id}/storyboard?ep=${episodeId}`,
      label: '分鏡',
      icon: Clapperboard,
    },
    {
      href: `/projects/${project.id}/episodes/${episodeId}/assets`,
      label: '素材',
      icon: Package,
    },
    /*
     * 版本比對 (Z163, design 35)。
     *
     * 比對本身在版本紀錄頁早就做好了（DiffViewer、同文件限定、還原）。缺的
     * 一直是**從某一集進去**——`?ep=EP007` 會預選那一集最新的兩版。
     */
    {
      href: `/projects/${project.id}/versions?ep=${label}`,
      label: '版本比對',
      icon: GitCompare,
    },
  ]

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={`/projects/${project.id}/episodes?ep=${episodeId}`}
          className="text-[11px] text-accent-400 transition-colors hover:text-accent-300"
        >
          ← 回集數管理
        </Link>

        <span className="rounded bg-stage-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-200 ring-1 ring-inset ring-stage-700">
          {label}
        </span>
        <h2 className="text-sm font-semibold text-ink-50">
          {row.title || <span className="text-ink-600">未命名</span>}
        </h2>
        <EpisodeStatusChip status={row.status} />
        <span className="text-[11px] text-ink-500 tabular-nums">
          完成率 {toPercent(row.progress)}%
        </span>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl">
            {row.coverAssetId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetPreviewUrl(row.coverAssetId)}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <div aria-hidden className="art-placeholder absolute inset-0" />
            )}
          </div>

          {/* 每一段內容一個入口。這一頁的另一半理由就是它。 */}
          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="tap flex items-center gap-1.5 rounded-lg bg-stage-900 px-3 py-2 text-[11px] text-ink-200 ring-1 ring-stage-700/60 transition-colors hover:text-ink-50 hover:ring-stage-600"
              >
                <link.icon aria-hidden className="size-3.5 text-accent-400" />
                {link.label}
              </Link>
            ))}
          </nav>

          <dl className="grid gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">
            <Row label="目標片長">{editable.targetSec} 秒</Row>
            <Row label="期限">
              {editable.dueDate ? editable.dueDate.toISOString().slice(0, 10) : '沒有設定'}
            </Row>
          </dl>

          <Block title="劇情重點" body={editable.logline} empty="尚未撰寫。" />
          <Block title="分集大綱" body={editable.synopsis} empty="還沒有大綱。" />
          {editable.notes && <Block title="備註" body={editable.notes} empty="" />}
        </div>

        <EpisodeStageBoard
          projectId={project.id}
          episodeId={episodeId}
          stages={row.stages.map((cell) => ({
            key: cell.key,
            status: cell.status,
            progressPercent: cell.progressPercent,
            note: cell.note,
          }))}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink-600">{label}</dt>
      <dd className="text-ink-200">{children}</dd>
    </div>
  )
}

function Block({ title, body, empty }: { title: string; body: string; empty: string }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[11px] font-medium text-ink-400">{title}</h3>
      <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-300">
        {body || <span className="text-ink-600">{empty}</span>}
      </p>
    </section>
  )
}
