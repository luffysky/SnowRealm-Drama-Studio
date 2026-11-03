import {
  Database,
  FileText,
  Film,
  Image as ImageIcon,
  Mic,
  Music,
  Package,
  Plus,
  ShieldCheck,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { AssetCenterNav } from '@/components/assets/AssetCenterNav'
import { EmptyState } from '@/components/ui/StateViews'
import type { AssetCenterData } from '@/lib/asset-center'
import { assetPreviewUrl } from '@/lib/asset-url'
import { ASSET_KIND_LABEL, type AssetKindValue } from '@/lib/constants'
import { convert, formatMoney, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn, formatDurationZh, formatRelativeZh } from '@/lib/utils'

/**
 * 81 素材資產中心總覽 (Z4).
 *
 * A Server Component: everything on it is a count, and counts belong next to
 * the query that produced them. Nothing here is interactive except links.
 *
 * The reference art shows a storage bar reading 「256.8 GB / 1 TB」. That
 * denominator is not reproduced — R2 has no per-bucket quota, so a bar against
 * 1 TB would imply a limit that does not exist and a fullness that is
 * meaningless. The cost is what actually grows, so the cost is what is shown.
 */

const KIND_ICON: Partial<Record<AssetKindValue, LucideIcon>> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  MUSIC: Music,
  SFX: Volume2,
  VOICE: Mic,
  DOC: FileText,
}

/** The six the design puts on cards, in pipeline order. */
const FEATURED: AssetKindValue[] = ['IMAGE', 'VIDEO', 'MUSIC', 'SFX', 'VOICE', 'DOC']

const KIND_HINT: Partial<Record<AssetKindValue, string>> = {
  IMAGE: '場景・角色・道具・概念圖',
  VIDEO: '分鏡影片・素材片段・成片',
  MUSIC: '主題曲・插曲・BGM',
  SFX: '環境音・動作音・轉場',
  VOICE: '角色配音・旁白・台詞',
  DOC: '腳本・授權・參考資料',
}

export function AssetCenterOverview({
  projectId,
  data,
  currency,
  fx,
}: {
  projectId: string
  data: AssetCenterData
  currency: CurrencyValue
  fx: FxRates
}) {
  const counts = Object.fromEntries(data.byKind.map((row) => [row.kind, row.count]))

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Package aria-hidden className="size-4 text-accent-400" />
          素材資產中心
        </h2>
        <p className="text-[11px] text-ink-500">
          圖片、影片、音樂、音效、配音與文件，集中管理分類、版本、授權與集數關聯。
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <AssetCenterNav projectId={projectId} counts={counts} />

        <Link
          href={`/projects/${projectId}/assets/music/new`}
          className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-500"
        >
          <Plus aria-hidden className="size-3.5" />
          新增音樂
        </Link>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Package aria-hidden className="size-3.5 text-accent-400" />}
          label="全部素材"
          value={data.total.toLocaleString('en-US')}
          unit="個檔案"
        />
        <Stat
          icon={<Database aria-hidden className="size-3.5 text-accent-400" />}
          label="已使用空間"
          value={formatBytes(data.sizeBytes)}
          unit=""
        />
        <Stat
          icon={<Database aria-hidden className="size-3.5 text-accent-400" />}
          label="估算月費"
          value={
            data.estimatedMonthlyUsd > 0
              ? formatMoney(convert(data.estimatedMonthlyUsd, 'USD', currency, fx), currency)
              : formatMoney(0, currency)
          }
          unit=""
          hint="R2 每月前 10 GB 免費，之後約 $0.015/GB。對外流量不計費。"
        />
        <Stat
          icon={<ShieldCheck aria-hidden className="size-3.5 text-accent-400" />}
          label="授權待確認"
          value={String(data.licenses.pending)}
          unit={`/ ${data.licenses.total} 筆`}
          hint={
            data.licenses.expiringSoon > 0
              ? `另有 ${data.licenses.expiringSoon} 筆將於 90 天內到期`
              : undefined
          }
          warn={data.licenses.pending > 0}
        />
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink-300">分類</h3>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURED.map((kind) => {
            const row = data.byKind.find((item) => item.kind === kind)
            const Icon = KIND_ICON[kind]

            return (
              <li key={kind}>
                {/*
                  Not a link: the per-kind lists are Z5 onwards. A card that
                  looked clickable and did nothing would be worse than one that
                  says what it is waiting for.
                */}
                <div
                  className={cn(
                    'panel flex h-full flex-col gap-1 rounded-xl bg-stage-900 p-3 ring-1',
                    (row?.count ?? 0) > 0 ? 'ring-stage-700' : 'ring-stage-800'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {Icon && <Icon aria-hidden className="size-3.5 text-accent-400" />}
                    <span className="text-[11px] font-medium text-ink-200">
                      {ASSET_KIND_LABEL[kind]}
                    </span>
                    <span className="ml-auto rounded bg-stage-800 px-1.5 py-0.5 text-[9px] text-ink-700">
                      M3
                    </span>
                  </div>

                  <p className="text-xl leading-tight font-semibold text-ink-50 tabular-nums">
                    {row?.count ?? 0}
                    <span className="ml-1 text-[10px] font-normal text-ink-500">檔</span>
                    {(row?.sizeBytes ?? 0) > 0 && (
                      <span className="ml-2 text-[10px] font-normal text-ink-600">
                        {formatBytes(row?.sizeBytes ?? 0)}
                      </span>
                    )}
                  </p>

                  <p className="text-[10px] text-ink-600">{KIND_HINT[kind]}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="border-b border-stage-700/60 px-4 py-2.5">
            <h3 className="text-xs font-medium text-ink-200">近期上傳</h3>
          </header>

          {data.recent.length === 0 ? (
            <EmptyState
              title="還沒有素材"
              description="從集數的「本集素材」上傳，檔案會出現在這裡。"
              className="py-12"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-stage-700/40">
              {data.recent.map((item) => {
                const Icon = KIND_ICON[item.kind]
                return (
                  <li key={item.id} className="flex items-center gap-2.5 px-4 py-2">
                    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded bg-stage-950">
                      {item.hasPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={assetPreviewUrl(item.id)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover"
                        />
                      ) : Icon ? (
                        <Icon aria-hidden className="size-3.5 text-ink-700" />
                      ) : null}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[11px] text-ink-100">
                        {item.title || item.name}
                      </span>
                      <span className="truncate text-[10px] text-ink-600">
                        {ASSET_KIND_LABEL[item.kind]}
                        {item.episodeNumber !== null &&
                          `・EP${String(item.episodeNumber).padStart(3, '0')}`}
                        {item.uploadedByName && `・${item.uploadedByName}`}
                      </span>
                    </span>

                    <span className="shrink-0 text-right text-[10px] text-ink-600">
                      <span className="block">
                        {item.durationSec !== null
                          ? formatDurationZh(item.durationSec)
                          : formatBytes(item.sizeBytes)}
                      </span>
                      <span className="block">{formatRelativeZh(item.createdAt)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="border-b border-stage-700/60 px-4 py-2.5">
            <h3 className="text-xs font-medium text-ink-200">與集數關聯</h3>
          </header>

          {data.episodes.length === 0 ? (
            <EmptyState
              title="尚未有素材綁定集數"
              description="上傳時選定集數，就會在這裡看到分佈。"
              className="py-12"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-stage-700/40">
              {data.episodes.map((row) => (
                <li key={row.episodeId}>
                  <Link
                    href={`/projects/${projectId}/episodes/${row.episodeId}/assets`}
                    className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-stage-800/60"
                  >
                    <span className="h-9 w-14 shrink-0 overflow-hidden rounded bg-stage-950">
                      {row.coverAssetId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={assetPreviewUrl(row.coverAssetId)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover"
                        />
                      ) : (
                        <span aria-hidden className="art-placeholder block size-full" />
                      )}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[11px] font-medium text-ink-200 tabular-nums">
                        EP{String(row.number).padStart(3, '0')}
                      </span>
                      <span className="truncate text-[10px] text-ink-600">
                        {row.title || '未命名'}
                      </span>
                    </span>

                    <span className="shrink-0 text-[10px] text-ink-500">{row.count} 個素材</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  unit,
  hint,
  warn,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  hint?: string
  warn?: boolean
}) {
  return (
    <div
      className={cn(
        'panel flex flex-col gap-0.5 rounded-xl bg-stage-900 p-3 ring-1',
        warn ? 'ring-amber-500/40' : 'ring-stage-700'
      )}
    >
      <dt className="flex items-center gap-1.5 text-[10px] text-ink-600">
        {icon}
        {label}
      </dt>
      <dd className="text-lg leading-tight font-semibold text-ink-50 tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-ink-500">{unit}</span>}
      </dd>
      {hint && <p className="text-[10px] leading-relaxed text-ink-700">{hint}</p>}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
