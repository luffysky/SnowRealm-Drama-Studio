/**
 * 助理的對話串 (Z100).
 *
 * The assistant used to live inside the two-person thread, woken by `@助理`.
 * That put a question to a model in the middle of two people talking to each
 * other: same scrollback, same search results, same unread badge. It also
 * made the assistant's own history and theirs the same history, so the rule
 * 「只讀自己的那幾輪」 had to be enforced with a regex over message bodies.
 *
 * Here it has its own threads, one per person, several per person. A thread
 * is a `conversations` row with `kind = 'ASSISTANT'` rather than a new table,
 * which means messages, attachments, recall, edit, search and history paging
 * all work as they already did — and `assertMember` is still the only guard
 * every route needs, because the owner is the thread's only member.
 */
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import { conversationMembers, conversations, messages } from '@/db/schema'
import { ApiError } from '@/lib/api'

/** How many threads one person may keep. A list, not an archive. */
export const MAX_THREADS = 50

export type AssistantThread = {
  id: string
  title: string
  /** The last thing said in it, for the list. Empty for a new thread. */
  preview: string
  messageCount: number
  updatedAt: Date
  createdAt: Date
}

const UNTITLED = '新對話'

/* -------------------------------------------------------------------------- */

/**
 * This person's threads, most recently used first.
 *
 * Three queries rather than one with correlated subqueries, and that is not a
 * style preference. The first version computed the count and the preview as
 * `sql` subqueries in the select list, and Drizzle renders an interpolated
 * column **unqualified** there — so
 *
 *     where ${messages.conversationId} = ${conversations.id}
 *
 * compiled to `where "conversation_id" = "id"`, and Postgres resolved both
 * names inside the subquery: every row compared `messages.conversation_id`
 * against `messages.id`. No error, no empty result — just a correlation that
 * is always false, so every thread listed with no preview and a count of 0.
 * (In a `where` clause Drizzle does qualify, which is why the same shape is
 * correct elsewhere in this codebase.)
 */
export async function listThreads(userId: string): Promise<AssistantThread[]> {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(eq(conversations.kind, 'ASSISTANT'), eq(conversations.ownerId, userId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(MAX_THREADS)

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)

  const counts = await db
    .select({ conversationId: messages.conversationId, n: count() })
    .from(messages)
    .where(and(inArray(messages.conversationId, ids), isNull(messages.recalledAt)))
    .groupBy(messages.conversationId)

  /*
   * `distinct on` gives the newest line per thread in one pass. The
   * alternative — fetching the rows and taking the first of each in
   * JavaScript — reads every message of every thread to show 80 characters.
   */
  const previews = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      body: messages.body,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, ids),
        isNull(messages.recalledAt),
        ne(messages.body, '')
      )
    )
    .orderBy(messages.conversationId, desc(messages.seq))

  const countOf = new Map(counts.map((row) => [row.conversationId, Number(row.n)]))
  const previewOf = new Map(previews.map((row) => [row.conversationId, row.body]))

  return rows.map((row) => ({
    id: row.id,
    title: row.title || UNTITLED,
    preview: (previewOf.get(row.id) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    messageCount: countOf.get(row.id) ?? 0,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }))
}

/** Starts a thread. The owner is its only member. */
export async function createThread(userId: string, title?: string): Promise<AssistantThread> {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(eq(conversations.kind, 'ASSISTANT'), eq(conversations.ownerId, userId)))

  if ((existing[0]?.count ?? 0) >= MAX_THREADS) {
    throw ApiError.badRequest(`對話串最多 ${MAX_THREADS} 條，先刪掉一些再開新的`)
  }

  const row = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({ kind: 'ASSISTANT', ownerId: userId, title: (title ?? '').trim().slice(0, 60) })
      .returning()

    if (!conversation) throw new ApiError(500, '建立對話串失敗', 'thread_create_failed')

    await tx.insert(conversationMembers).values({ conversationId: conversation.id, userId })
    return conversation
  })

  return {
    id: row.id,
    title: row.title || UNTITLED,
    preview: '',
    messageCount: 0,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}

/**
 * The thread to open, creating the first one if this person has none.
 *
 * Created on read rather than at sign-up, for the same reason the direct
 * thread is: seeding one would mean a migration inventing a row whose id
 * nothing references yet.
 */
export async function openThread(userId: string): Promise<string> {
  const [newest] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.kind, 'ASSISTANT'), eq(conversations.ownerId, userId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(1)

  if (newest) return newest.id

  return (await createThread(userId)).id
}

/**
 * Throws unless this is the caller's own assistant thread.
 *
 * Stricter than `assertMember` on purpose: membership would also admit the
 * direct thread, and a run started against that would send two people's
 * conversation to a model — the exact thing this separation prevents.
 */
export async function assertOwnThread(threadId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, threadId),
        eq(conversations.kind, 'ASSISTANT'),
        eq(conversations.ownerId, userId)
      )
    )
    .limit(1)

  if (!row) throw ApiError.forbidden('那不是你的助理對話串')
}

export async function renameThread(
  threadId: string,
  userId: string,
  title: string
): Promise<AssistantThread> {
  await assertOwnThread(threadId, userId)

  const [row] = await db
    .update(conversations)
    .set({ title: title.trim().slice(0, 60) })
    .where(eq(conversations.id, threadId))
    .returning()

  if (!row) throw ApiError.notFound('找不到那條對話串')

  return {
    id: row.id,
    title: row.title || UNTITLED,
    preview: '',
    messageCount: 0,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}

/**
 * Deletes a thread and everything said in it.
 *
 * Proposals cascade with it. Any proposal that was *applied* is already a
 * `versions` snapshot plus the edit itself, so the work and its backup
 * survive — what goes is the record of the conversation that produced them.
 */
export async function deleteThread(threadId: string, userId: string): Promise<void> {
  await assertOwnThread(threadId, userId)
  await db.delete(conversations).where(eq(conversations.id, threadId))
}

/**
 * Names an untitled thread after its first exchange.
 *
 * Called with the person's own first message rather than asking the model for
 * a title: a second round trip to name a thread is money spent on a label,
 * and the first line of a request is almost always what the thread is about.
 */
export async function titleFromFirstMessage(threadId: string, body: string): Promise<void> {
  const [current] = await db
    .select({ title: conversations.title })
    .from(conversations)
    .where(eq(conversations.id, threadId))
    .limit(1)

  // Only an untitled thread. A title someone typed is theirs to keep.
  if (!current || current.title.trim()) return

  const title = body
    .replace(/^\/[a-zA-Z]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)

  if (!title) return

  await db.update(conversations).set({ title }).where(eq(conversations.id, threadId))
}
