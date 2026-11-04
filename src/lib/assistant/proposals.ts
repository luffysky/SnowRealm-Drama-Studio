import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assistantProposals,
  characters,
  chapters,
  documents,
  episodes,
  versions,
  worldEntries,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { countRichTextChars } from '@/lib/utils'

/**
 * 套用或拒絕助理的提案 (Z100).
 *
 * The assistant proposes; this is the only place a proposal becomes an edit,
 * and it always takes a `versions` snapshot of what is being replaced first.
 *
 * That backup is not a checkbox. 「取代」 and 「取代並備份」 are the same
 * operation, because the alternative — overwriting with no snapshot — hands a
 * model the ability to delete something a person wrote with no way back. The
 * cost of always keeping one is a row of JSON.
 */

export type ProposalRow = {
  id: string
  targetType: string
  targetId: string
  field: string
  beforeValue: string
  afterValue: string
  rationale: string
  state: string
  backupVersionId: string | null
  decidedAt: Date | null
  createdAt: Date
  /** Whether the target still holds what the proposal was written against. */
  stale: boolean
}

const FIELD_LABEL: Record<string, string> = {
  content: '正文',
  title: '標題',
  logline: '一句話',
  synopsis: '大綱',
  personality: '性格',
  background: '背景',
  appearance: '外觀',
  growth: '成長弧線',
  visualPrompt: '定妝提示詞',
  summary: '摘要',
  body: '內容',
}

const TARGET_LABEL: Record<string, string> = {
  chapter: '章節',
  episode_outline: '分集大綱',
  character: '角色',
  world_entry: '世界觀',
}

export function describeProposal(row: { targetType: string; field: string }): string {
  return `${TARGET_LABEL[row.targetType] ?? row.targetType}・${FIELD_LABEL[row.field] ?? row.field}`
}

/** Proposals attached to a set of messages, for rendering in the thread. */
export async function proposalsForMessages(
  messageIds: string[]
): Promise<Map<string, ProposalRow[]>> {
  if (messageIds.length === 0) return new Map()

  const rows = await db
    .select()
    .from(assistantProposals)
    .where(inArray(assistantProposals.messageId, messageIds))
    .orderBy(asc(assistantProposals.createdAt))

  const out = new Map<string, ProposalRow[]>()

  for (const row of rows) {
    // Checked at read time rather than stored: the target can change at any
    // moment, and a flag written when the proposal was made would be a lie
    // the instant someone edited the chapter.
    const current = await readValue(row.targetType, row.targetId, row.field)
    const stale = row.state === 'PENDING' && current !== null && current !== row.beforeValue

    const list = out.get(row.messageId ?? '') ?? []
    list.push({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      field: row.field,
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      rationale: row.rationale,
      state: row.state,
      backupVersionId: row.backupVersionId,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
      stale,
    })
    out.set(row.messageId ?? '', list)
  }

  return out
}

/**
 * Applies a proposal, after snapshotting what it replaces.
 *
 * Refuses when the target has changed since the proposal was written: the
 * assistant rewrote one version of a chapter, and quietly pasting that over a
 * newer one would delete work it never saw.
 */
export async function applyProposal(
  proposalId: string,
  user: SessionUser,
  options: { force?: boolean } = {}
): Promise<ProposalRow> {
  const [row] = await db
    .select()
    .from(assistantProposals)
    .where(eq(assistantProposals.id, proposalId))
    .limit(1)

  if (!row) throw ApiError.notFound('找不到這個提案')
  if (row.state !== 'PENDING') throw ApiError.badRequest('這個提案已經處理過了')

  const current = await readValue(row.targetType, row.targetId, row.field)
  if (current === null) throw ApiError.badRequest('提案的目標已經不存在了')

  if (current !== row.beforeValue && !options.force) {
    throw new ApiError(
      409,
      '這段內容在提案之後有人改過。套用會蓋掉那些修改——確認過再選「仍要套用」。',
      'proposal_stale'
    )
  }

  const backupId = await snapshot({
    targetType: row.targetType,
    targetId: row.targetId,
    field: row.field,
    value: current,
    user,
  })

  await writeValue(row.targetType, row.targetId, row.field, row.afterValue)

  const [updated] = await db
    .update(assistantProposals)
    .set({
      state: 'APPLIED',
      backupVersionId: backupId,
      decidedById: user.id,
      decidedAt: new Date(),
    })
    .where(eq(assistantProposals.id, proposalId))
    .returning()

  if (!updated) throw new ApiError(500, '套用後讀不回來', 'proposal_read_failed')

  return {
    ...updated,
    stale: false,
  } as ProposalRow
}

export async function rejectProposal(
  proposalId: string,
  user: SessionUser
): Promise<ProposalRow> {
  const [updated] = await db
    .update(assistantProposals)
    .set({ state: 'REJECTED', decidedById: user.id, decidedAt: new Date() })
    .where(
      and(eq(assistantProposals.id, proposalId), eq(assistantProposals.state, 'PENDING'))
    )
    .returning()

  if (!updated) throw ApiError.badRequest('這個提案已經處理過了，或者不存在')

  return { ...updated, stale: false } as ProposalRow
}

/* -------------------------------------------------------------------------- */

/**
 * Stores what is about to be overwritten.
 *
 * Into `versions`, the table the whole project already restores from — so a
 * backup made here appears in 版本紀錄 beside every other snapshot and can be
 * restored by the screen that already exists, rather than only by whatever UI
 * the assistant happens to grow.
 */
async function snapshot(input: {
  targetType: string
  targetId: string
  field: string
  value: string
  user: SessionUser
}): Promise<string | null> {
  /*
   * Every target type, not just chapters.
   *
   * The first version only snapshotted documents, because `version_target`
   * had no EPISODE value — so applying a proposal to an outline, a character
   * or a world entry overwrote it with nothing to restore from, while this
   * file claimed a backup was part of applying. `0020` added the value; this
   * is the rest of the fix.
   */
  const target = await versionTargetFor(input.targetType, input.targetId)
  if (!target) return null

  const [latest] = await db
    .select({ version: versions.version })
    .from(versions)
    .where(and(eq(versions.targetType, target.type), eq(versions.targetId, target.id)))
    .orderBy(desc(versions.version))
    .limit(1)

  const [created] = await db
    .insert(versions)
    .values({
      targetType: target.type,
      targetId: target.id,
      version: (latest?.version ?? 0) + 1,
      snapshot: target.snapshot,
      charCount: target.charCount,
      label: `套用 AI 助理提案前的備份（${input.field}）`,
      authorId: input.user.id,
      authorName: input.user.name,
    })
    .returning({ id: versions.id })

  return created?.id ?? null
}

/**
 * What to snapshot, and under which `versions` row.
 *
 * A chapter snapshots its whole document, because that is the unit 版本紀錄
 * already restores. The others snapshot their own row — restoring one field
 * in isolation would leave a record that cannot be read back as a state the
 * work was ever actually in.
 */
async function versionTargetFor(
  targetType: string,
  targetId: string
): Promise<{ type: 'DOCUMENT' | 'EPISODE' | 'CHARACTER' | 'WORLD_ENTRY'; id: string; snapshot: unknown; charCount: number } | null> {
  switch (targetType) {
    case 'chapter': {
      const documentId = await documentIdForChapter(targetId)
      if (!documentId) return null

      const rows = await db
        .select({
          id: chapters.id,
          sortOrder: chapters.sortOrder,
          title: chapters.title,
          content: chapters.content,
        })
        .from(chapters)
        .where(eq(chapters.documentId, documentId))
        .orderBy(asc(chapters.sortOrder))

      return {
        type: 'DOCUMENT',
        id: documentId,
        snapshot: { chapters: rows },
        charCount: rows.reduce((n, c) => n + countRichTextChars(c.content), 0),
      }
    }

    case 'episode_outline': {
      const [row] = await db.select().from(episodes).where(eq(episodes.id, targetId)).limit(1)
      if (!row) return null

      return {
        type: 'EPISODE',
        id: row.id,
        snapshot: { title: row.title, logline: row.logline, synopsis: row.synopsis },
        charCount: row.synopsis.length + row.logline.length,
      }
    }

    case 'character': {
      const [row] = await db.select().from(characters).where(eq(characters.id, targetId)).limit(1)
      if (!row) return null

      return {
        type: 'CHARACTER',
        id: row.id,
        snapshot: {
          name: row.name,
          appearance: row.appearance,
          personality: row.personality,
          background: row.background,
          growth: row.growth,
          visualPrompt: row.visualPrompt,
        },
        charCount:
          row.appearance.length + row.personality.length + row.background.length + row.growth.length,
      }
    }

    case 'world_entry': {
      const [row] = await db.select().from(worldEntries).where(eq(worldEntries.id, targetId)).limit(1)
      if (!row) return null

      return {
        type: 'WORLD_ENTRY',
        id: row.id,
        snapshot: { title: row.title, summary: row.summary, body: row.body },
        charCount: row.summary.length + row.body.length,
      }
    }

    default:
      return null
  }
}

async function documentIdForChapter(chapterId: string): Promise<string | null> {
  const [row] = await db
    .select({ documentId: chapters.documentId })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  return row?.documentId ?? null
}

async function readValue(
  targetType: string,
  targetId: string,
  field: string
): Promise<string | null> {
  switch (targetType) {
    case 'chapter': {
      const [row] = await db.select().from(chapters).where(eq(chapters.id, targetId)).limit(1)
      if (!row) return null
      return field === 'content' ? row.content : field === 'title' ? row.title : null
    }
    case 'episode_outline': {
      const [row] = await db.select().from(episodes).where(eq(episodes.id, targetId)).limit(1)
      if (!row) return null
      if (field === 'title') return row.title
      if (field === 'logline') return row.logline
      if (field === 'synopsis') return row.synopsis
      return null
    }
    case 'character': {
      const [row] = await db.select().from(characters).where(eq(characters.id, targetId)).limit(1)
      if (!row) return null
      const allowed = ['personality', 'background', 'appearance', 'growth', 'visualPrompt'] as const
      if (!(allowed as readonly string[]).includes(field)) return null
      return row[field as (typeof allowed)[number]]
    }
    case 'world_entry': {
      const [row] = await db.select().from(worldEntries).where(eq(worldEntries.id, targetId)).limit(1)
      if (!row) return null
      return field === 'summary' ? row.summary : field === 'body' ? row.body : null
    }
    default:
      return null
  }
}

async function writeValue(
  targetType: string,
  targetId: string,
  field: string,
  value: string
): Promise<void> {
  const now = new Date()

  switch (targetType) {
    case 'chapter': {
      await db
        .update(chapters)
        .set({
          ...(field === 'content'
            ? { content: value, charCount: countRichTextChars(value) }
            : { title: value }),
          updatedAt: now,
        })
        .where(eq(chapters.id, targetId))

      if (field === 'content') {
        // The document's own count is what every progress figure reads.
        const documentId = await documentIdForChapter(targetId)
        if (documentId) {
          const [sum] = await db
            .select({ total: sql<number>`coalesce(sum(${chapters.charCount}), 0)`.mapWith(Number) })
            .from(chapters)
            .where(eq(chapters.documentId, documentId))

          await db
            .update(documents)
            .set({
              charCount: sum?.total ?? 0,
              // Anyone holding this document open now has a stale view; their
              // next save must be refused rather than silently undo this.
              lockRevision: sql`${documents.lockRevision} + 1`,
              updatedAt: now,
            })
            .where(eq(documents.id, documentId))
        }
      }
      return
    }

    case 'episode_outline': {
      await db
        .update(episodes)
        .set({
          ...(field === 'title' ? { title: value } : {}),
          ...(field === 'logline' ? { logline: value } : {}),
          ...(field === 'synopsis' ? { synopsis: value } : {}),
          updatedAt: now,
        })
        .where(eq(episodes.id, targetId))
      return
    }

    case 'character': {
      await db
        .update(characters)
        .set({ [field]: value, updatedAt: now })
        .where(eq(characters.id, targetId))
      return
    }

    case 'world_entry': {
      await db
        .update(worldEntries)
        .set({ [field]: value, updatedAt: now })
        .where(eq(worldEntries.id, targetId))
      return
    }

    default:
      throw ApiError.badRequest(`不支援的提案目標：${targetType}`)
  }
}
