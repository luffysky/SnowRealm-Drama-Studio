import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ReviewBoard } from '@/components/studio/ReviewBoard'
import { can } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'
import { requireProjectPage } from '@/lib/project-access'
import { reviewBoard } from '@/lib/reviews'

export const metadata: Metadata = { title: '審核發布' }

type Params = { params: Promise<{ projectId: string }> }

/**
 * 審核發布 (Z41, designs 57–58).
 *
 * `approval_records` 與 `reviews` 兩張表都在、`approvals.ts` 把定稿與鎖定的語
 * 意寫得很完整，而兩張表零筆資料、那支 lib 的每一支函式都沒有任何地方呼叫。
 *
 * 其中最要緊的一條是 `assertNotLocked`：它的註解寫著「Call this at the top of
 * any write path」，而它沒有被放在任何一條寫入路徑上。所以 Z41 不是做一頁，
 * 是先讓那個鎖真的鎖得住（小說存檔、劇本存檔、章節新增刪除、AI 採用），再做
 * 看得到它的頁面。
 */
export default async function ReviewsPage({ params }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)

  const board = await reviewBoard(project.id)

  return (
    <ReviewBoard
      projectId={project.id}
      rows={board.rows.map((row) => ({
        documentId: row.documentId,
        kindLabel: row.kindLabel,
        episodeId: row.episodeId,
        episodeNumber: row.episodeNumber,
        episodeTitle: row.episodeTitle,
        version: row.version,
        charCount: row.charCount,
        latestVersionId: row.latestVersionId,
        latestVersionNumber: row.latestVersionNumber,
        state: row.state,
        locked: row.locked,
        approvedVersionNumber: row.approvedVersionNumber,
        note: row.note,
        unlockReason: row.unlockReason,
        // 伺服器元件傳到用戶端要可序列化，Date 不是。
        decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
        decidedByName: row.decidedByName,
        openNotes: row.openNotes,
      }))}
      counts={board.counts}
      canWrite={can(user, 'document.write')}
    />
  )
}
