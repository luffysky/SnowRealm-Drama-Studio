import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { approvalRecords, documents, versions } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'

/**
 * 定稿 and the lock it implies (spec v2 §6.5「已定稿內容必須透過審核解鎖或建立修訂版」).
 *
 * Approving pins one exact version and locks the target. Editing afterwards is
 * refused until someone unlocks it with a stated reason. Nothing is ever
 * mutated or deleted: an unlock is a new row that supersedes the approval, so
 * who locked, who reopened, and why all stay on the record.
 */

export type ApprovalRow = typeof approvalRecords.$inferSelect

export type ApprovalTarget = 'DOCUMENT' | 'SHOT' | 'CHARACTER' | 'WORLD_ENTRY' | 'ASSET'

/** The approval currently in force for a target, if any. */
export async function currentApproval(
  targetType: ApprovalTarget,
  targetId: string
): Promise<ApprovalRow | null> {
  const [row] = await db
    .select()
    .from(approvalRecords)
    .where(
      and(eq(approvalRecords.targetType, targetType), eq(approvalRecords.targetId, targetId))
    )
    .orderBy(desc(approvalRecords.createdAt))
    .limit(1)

  return row ?? null
}

/** Whether edits to this target are currently blocked by an approval lock. */
export async function isLocked(
  targetType: ApprovalTarget,
  targetId: string
): Promise<boolean> {
  const approval = await currentApproval(targetType, targetId)
  return Boolean(approval?.locks)
}

/**
 * Throws 409 when the target is locked. Call this at the top of any write path
 * for approvable content — a hidden Save button is not an authorisation check.
 */
export async function assertNotLocked(
  targetType: ApprovalTarget,
  targetId: string
): Promise<void> {
  const approval = await currentApproval(targetType, targetId)
  if (approval?.locks) {
    throw ApiError.conflict(
      '這份內容已定稿並鎖定。請先解除鎖定，或建立修訂版本後再編輯。',
      { approvalId: approval.id, approvedAt: approval.decidedAt }
    )
  }
}

/** Opens a review request. Does not lock anything by itself. */
export async function requestApproval(input: {
  user: SessionUser
  projectId: string
  targetType: ApprovalTarget
  targetId: string
  versionId?: string | null
  note?: string
}): Promise<ApprovalRow> {
  const [row] = await db
    .insert(approvalRecords)
    .values({
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      versionId: input.versionId ?? null,
      state: 'PENDING',
      locks: false,
      note: input.note ?? '',
      requestedById: input.user.id,
    })
    .returning()

  if (!row) throw new Error('Failed to create approval request')

  await logActivity({
    user: input.user,
    action: 'approval.request',
    entityType: input.targetType.toLowerCase(),
    entityId: input.targetId,
    projectId: input.projectId,
    summary: `${input.user.name} 送出定稿審核`,
  })

  return row
}

/**
 * Approves a specific version and locks the target.
 *
 * `versionId` is required: approving "whatever is current" would make the
 * record meaningless the moment someone saves again.
 */
export async function approve(input: {
  user: SessionUser
  projectId: string
  targetType: ApprovalTarget
  targetId: string
  versionId: string
  note?: string
}): Promise<ApprovalRow> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select({ id: versions.id, targetId: versions.targetId })
      .from(versions)
      .where(eq(versions.id, input.versionId))
      .limit(1)

    if (!version) throw ApiError.notFound('找不到要定稿的版本')
    if (version.targetId !== input.targetId) {
      throw ApiError.badRequest('該版本不屬於這個內容')
    }

    const previous = await currentApproval(input.targetType, input.targetId)
    if (previous?.locks) {
      throw ApiError.conflict('這份內容已經定稿；如需重新定稿，請先解除鎖定。')
    }

    const [row] = await tx
      .insert(approvalRecords)
      .values({
        projectId: input.projectId,
        targetType: input.targetType,
        targetId: input.targetId,
        versionId: input.versionId,
        state: 'APPROVED',
        locks: true,
        note: input.note ?? '',
        decidedById: input.user.id,
        decidedAt: new Date(),
        supersedesId: previous?.id ?? null,
      })
      .returning()

    if (!row) throw new Error('Failed to record approval')

    await tx
      .update(versions)
      .set({ isApproved: true })
      .where(eq(versions.id, input.versionId))

    // Documents carry a pointer so the editor can show "定稿於 v5" without a join.
    if (input.targetType === 'DOCUMENT') {
      await tx
        .update(documents)
        .set({ approvedVersionId: input.versionId, updatedAt: new Date() })
        .where(eq(documents.id, input.targetId))
    }

    return row
  })
}

/** Rejects a pending request. Leaves the target unlocked. */
export async function reject(input: {
  user: SessionUser
  projectId: string
  targetType: ApprovalTarget
  targetId: string
  note: string
}): Promise<ApprovalRow> {
  const previous = await currentApproval(input.targetType, input.targetId)

  const [row] = await db
    .insert(approvalRecords)
    .values({
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      versionId: previous?.versionId ?? null,
      state: 'REJECTED',
      locks: false,
      note: input.note,
      decidedById: input.user.id,
      decidedAt: new Date(),
      supersedesId: previous?.id ?? null,
    })
    .returning()

  if (!row) throw new Error('Failed to record rejection')
  return row
}

/**
 * Lifts an approval lock so the content can be revised. Requires a reason —
 * the point of the lock is that reopening it is a deliberate, attributable act.
 */
export async function unlock(input: {
  user: SessionUser
  projectId: string
  targetType: ApprovalTarget
  targetId: string
  reason: string
}): Promise<ApprovalRow> {
  if (!input.reason.trim()) {
    throw ApiError.badRequest('解除鎖定必須說明原因')
  }

  const previous = await currentApproval(input.targetType, input.targetId)
  if (!previous?.locks) {
    throw ApiError.badRequest('這份內容目前沒有被鎖定')
  }

  const [row] = await db
    .insert(approvalRecords)
    .values({
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      versionId: previous.versionId,
      state: 'UNLOCKED',
      locks: false,
      unlockReason: input.reason.trim(),
      decidedById: input.user.id,
      decidedAt: new Date(),
      supersedesId: previous.id,
    })
    .returning()

  if (!row) throw new Error('Failed to record unlock')

  await logActivity({
    user: input.user,
    action: 'approval.unlock',
    entityType: input.targetType.toLowerCase(),
    entityId: input.targetId,
    projectId: input.projectId,
    summary: `${input.user.name} 解除定稿鎖定：${input.reason.trim()}`,
  })

  return row
}

/** Full history for a target, newest first. */
export async function approvalHistory(
  targetType: ApprovalTarget,
  targetId: string
): Promise<ApprovalRow[]> {
  return db
    .select()
    .from(approvalRecords)
    .where(
      and(eq(approvalRecords.targetType, targetType), eq(approvalRecords.targetId, targetId))
    )
    .orderBy(desc(approvalRecords.createdAt))
}
