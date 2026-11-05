import type { Metadata } from 'next'
import { asc } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { AiStudio } from '@/components/studio/AiStudio'
import { adapterFor } from '@/lib/ai/registry'
import { AVAILABLE_MODELS } from '@/lib/ai/anthropic'
import { listAssignments } from '@/lib/ai/assignments'
import { reviewInbox, spendSummary, throughput } from '@/lib/ai/insights'
import { listQueue, queueCounts } from '@/lib/ai/jobs'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { productionFindings } from '@/lib/production-findings'
import { listProjects } from '@/lib/projects'
import { getFxRates } from '@/lib/settings'

export const metadata: Metadata = { title: 'AI 製片中心' }
/** A queue is the one thing a cached render is always wrong about. */
export const dynamic = 'force-dynamic'

/**
 * AI 製片中心 (Z88, rebuilt Z127).
 *
 * Cross-project by nature, which is why it is in the global rail: 「哪種任務
 * 估得準」 and 「照這個速度 120 集要多少錢」 are not questions about one work
 * (`docs/ROUTES.md` §1). Generating for a single episode still happens inside
 * that episode's own pages — this page only ever *queues*, it never writes.
 *
 * Everything is gathered here rather than in the client so the first paint is
 * the real numbers. Seven queries in one `Promise.all`: a page of statistics
 * that renders empty and then fills in is a page you cannot trust the second
 * time you look at it.
 */
export default async function AiStudioPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const rows = await db.select().from(aiProviders).orderBy(asc(aiProviders.createdAt))

  const [
    jobs,
    counts,
    inbox,
    spend,
    capacity,
    findings,
    projectList,
    fx,
    providers,
    assignments,
  ] = await Promise.all([
      listQueue({}),
      queueCounts(),
      reviewInbox(),
      spendSummary(),
      throughput(),
      productionFindings(),
      /*
       * Only what 批次生成 needs to populate its picker: the works this member
       * can see, with how many episodes each has, so the range inputs can be
       * bounded rather than accepting EP999.
       */
      listProjects(user.id),
      getFxRates(),
      Promise.all(
        rows.map(async (row) => {
          const adapter = adapterFor(row)
          const status = adapter
            ? await adapter.status()
            : ({ available: false, reason: 'error', detail: '這類供應商還沒有適配器。' } as const)

          return {
            id: row.id,
            name: row.label,
            kind: row.kind as string,
            enabled: row.enabled,
            defaultModel: row.defaultModel,
            /*
             * The stored last four, not a slice of the ciphertext. Never the
             * key itself — only enough to tell two keys apart.
             */
            keyHint: row.apiKeyLast4,
            available: status.available,
            detail: status.detail ?? '',
          }
        })
      ),
      /*
       * 哪個任務用哪個模型 (Z152).
       *
       * 連**沒有指派的**任務一起列出來——只列已指派的話，一開始畫面是空的，
       * 而還在自動挑選的那些才是需要看見的。
       */
      listAssignments(),
    ])

  return (
    <AiStudio
      jobs={jobs.map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      }))}
      counts={counts}
      providers={providers}
      inbox={inbox}
      spend={spend}
      throughput={capacity}
      findings={findings}
      batchProjects={projectList.cards.map((card) => ({
        id: card.id,
        title: card.title,
        episodes: card.episodeCount,
      }))}
      currency={user.displayCurrency}
      fx={fx}
      canRun={can(user, 'ai.run')}
      canManageProviders={can(user, 'ai.provider.manage')}
      /*
       * 模型清單從這裡傳下去 (Z146).
       *
       * 不讓用戶端自己 import `lib/ai/anthropic`——那個檔案在模組層就 import
       * 了 Anthropic SDK，拉進瀏覽器包裡只為了一個字串陣列。
       */
      models={[...AVAILABLE_MODELS]}
      assignments={assignments}
    />
  )
}
