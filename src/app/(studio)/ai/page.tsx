import type { Metadata } from 'next'
import { asc } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { aiProviders } from '@/db/schema'
import { AiStudio } from '@/components/studio/AiStudio'
import { adapterFor } from '@/lib/ai/registry'
import { listQueue, queueCounts } from '@/lib/ai/jobs'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'AI 製片中心' }
/** A queue is the one thing a cached render is always wrong about. */
export const dynamic = 'force-dynamic'

/**
 * AI 製片中心 (Z88).
 *
 * The cross-project job queue and provider monitor. It stays in the global
 * rail only because of that word *cross-project* — generating for one work
 * happens inside that work's own pages, and a page here that could start a job
 * would need a project picker, which is the project workspace with extra
 * steps (`docs/ROUTES.md` §1).
 *
 * So this page answers two questions and no others: **what is the queue
 * doing**, and **is the provider actually reachable**. Both were previously
 * unanswerable without a database client — the API existed, nothing showed it.
 */
export default async function AiStudioPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const rows = await db.select().from(aiProviders).orderBy(asc(aiProviders.createdAt))

  const [jobs, counts, providers] = await Promise.all([
    listQueue({}),
    queueCounts(),
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
      canRun={can(user, 'ai.run')}
    />
  )
}
