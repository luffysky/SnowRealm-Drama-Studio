import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assets,
  callSignals,
  calls,
  conversationMembers,
  conversations,
  messages,
  presence,
  users,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { ProposalRow } from '@/lib/assistant/proposals'
import type { MessageKind } from '@/lib/chat-view'

/**
 * 即時對話 (Z99).
 *
 * Delivery is Server-Sent Events with polling behind it, because Vercel cannot
 * hold a WebSocket open. Both read the same thing: everything in a
 * conversation above a sequence number. That is the whole protocol, and it is
 * why `messages.seq` exists rather than clients paging by timestamp — two
 * messages in the same millisecond are indistinguishable by time, and a
 * reconnecting client would either miss one or replay it.
 */

export type ChatMessage = {
  id: string
  seq: number
  conversationId: string
  senderId: string | null
  senderName: string
  senderColor: string
  /** Said by the assistant rather than a member. */
  fromAssistant: boolean
  /** Edits it proposed in this reply. Empty for everything else. */
  proposals: ProposalRow[]
  kind: MessageKind
  body: string
  assetId: string | null
  assetName: string | null
  assetMime: string | null
  assetSize: number | null
  durationSec: number | null
  replyToId: string | null
  /** A one-line echo of the quoted message, so a reply renders in one query. */
  replyToBody: string | null
  replyToSender: string | null
  recalledAt: Date | null
  editedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The conversation this member belongs to, creating the pair's thread the
 * first time anyone opens it.
 *
 * Created on read rather than at sign-up: a studio of two people has exactly
 * one thread, and seeding it would mean a migration that invents a row whose
 * id nothing references yet.
 */
export async function openDirectConversation(userId: string): Promise<string> {
  const everyone = await db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt))

  if (!everyone.some((row) => row.id === userId)) {
    throw ApiError.forbidden('你不在這個工作室裡')
  }

  /*
   * Filtered to DIRECT, not just 「我所屬的第一個對話」.
   *
   * Since Z100 the assistant has its own threads, and the owner is a member
   * of each one. Without this filter the first assistant thread somebody
   * created could come back here — and 「訊息」 would open on a conversation
   * with a model in it instead of their colleague.
   */
  const mine = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, userId), eq(conversations.kind, 'DIRECT')))
    .limit(1)

  const existing = mine[0]?.conversationId
  if (existing) return existing

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({ kind: 'DIRECT' })
      .returning({ id: conversations.id })
    if (!conversation) throw new ApiError(500, '建立對話失敗', 'conversation_create_failed')

    // Everyone in the studio. With two accounts that is the direct thread; the
    // shape does not need changing if a third is ever added.
    await tx
      .insert(conversationMembers)
      .values(everyone.map((row) => ({ conversationId: conversation.id, userId: row.id })))

    return conversation.id
  })
}

/** Throws unless this member is in the conversation. Every route calls it. */
export async function assertMember(conversationId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId)
      )
    )
    .limit(1)

  if (!row) throw ApiError.forbidden('你不在這個對話裡')
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

const SELECT = {
  id: messages.id,
  seq: messages.seq,
  conversationId: messages.conversationId,
  senderId: messages.senderId,
  senderName: users.name,
  senderColor: users.color,
  fromAssistant: messages.fromAssistant,
  kind: messages.kind,
  body: messages.body,
  assetId: messages.assetId,
  assetName: assets.name,
  assetMime: assets.mimeType,
  assetSize: assets.sizeBytes,
  durationSec: messages.durationSec,
  replyToId: messages.replyToId,
  recalledAt: messages.recalledAt,
  editedAt: messages.editedAt,
  createdAt: messages.createdAt,
  updatedAt: messages.updatedAt,
}

function hydrate(
  rows: Awaited<ReturnType<typeof selectMessages>>,
  quoted: Map<string, { body: string; sender: string }>,
  proposals: Map<string, ProposalRow[]> = new Map()
): ChatMessage[] {
  return rows.map((row) => {
    const quote = row.replyToId ? quoted.get(row.replyToId) : undefined

    return {
      ...row,
      proposals: proposals.get(row.id) ?? [],
      kind: row.kind as MessageKind,
      senderName: row.fromAssistant ? 'AI 助理' : (row.senderName ?? '已離開的成員'),
      senderColor: row.fromAssistant ? '#22d3ee' : (row.senderColor ?? '#8b5cf6'),
      assetName: row.assetName ?? null,
      assetMime: row.assetMime ?? null,
      assetSize: row.assetSize ?? null,
      replyToBody: quote?.body ?? null,
      replyToSender: quote?.sender ?? null,
    }
  })
}

function selectMessages() {
  return db
    .select(SELECT)
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .leftJoin(assets, eq(assets.id, messages.assetId))
}

/** The one-line quotes for a page of replies, in a single extra query. */
/** Proposals for the assistant rows in a page. Nothing else can have any. */
async function proposalsFor(rows: { id: string; fromAssistant: boolean }[]) {
  const ids = rows.filter((row) => row.fromAssistant).map((row) => row.id)
  if (ids.length === 0) return new Map<string, ProposalRow[]>()

  const { proposalsForMessages } = await import('@/lib/assistant/proposals')
  return proposalsForMessages(ids)
}

async function quotesFor(rows: { replyToId: string | null }[]) {
  const ids = [...new Set(rows.map((row) => row.replyToId).filter(Boolean))] as string[]
  if (ids.length === 0) return new Map<string, { body: string; sender: string }>()

  const quoted = await db
    .select({
      id: messages.id,
      body: messages.body,
      kind: messages.kind,
      recalledAt: messages.recalledAt,
      sender: users.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(inArray(messages.id, ids))

  return new Map(
    quoted.map((row) => [
      row.id,
      {
        // A reply to something since taken back still shows that it was a
        // reply; it just has nothing to quote.
        body: row.recalledAt ? '訊息已收回' : row.body || labelFor(row.kind as MessageKind),
        sender: row.sender ?? '已離開的成員',
      },
    ])
  )
}

function labelFor(kind: MessageKind): string {
  switch (kind) {
    case 'IMAGE':
      return '［圖片］'
    case 'VIDEO':
      return '［影片］'
    case 'AUDIO':
      return '［音訊］'
    case 'VOICE':
      return '［語音訊息］'
    case 'FILE':
      return '［檔案］'
    case 'CALL':
      return '［通話］'
    default:
      return ''
  }
}

/**
 * A page of history, newest first.
 *
 * `before` pages backwards by sequence rather than offset: an offset shifts
 * under you every time a message arrives, which on a live thread means
 * scrolling up shows a row twice and skips another.
 */
export async function listMessages(input: {
  conversationId: string
  before?: number
  limit?: number
  search?: string
}): Promise<ChatMessage[]> {
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 100)

  const where = [eq(messages.conversationId, input.conversationId)]
  if (input.before !== undefined) where.push(lt(messages.seq, input.before))

  const term = input.search?.trim()
  if (term) {
    const like = `%${term}%`
    const match = or(ilike(messages.body, like), ilike(assets.name, like))
    if (match) where.push(match)
  }

  const rows = await selectMessages()
    .where(and(...where))
    .orderBy(desc(messages.seq))
    .limit(limit)

  return hydrate(rows, await quotesFor(rows), await proposalsFor(rows)).reverse()
}

/**
 * Everything the client has not seen: new messages, and old ones that changed.
 *
 * The second half is why `updated_at` exists. A recall does not move `seq` —
 * it must not, or the message would jump to the bottom of the thread — so a
 * sequence cursor alone never carried it, and the other side had to reload to
 * see that something had been taken back.
 *
 * Passing `since` as well as `afterSeq` keeps both in one query and one round
 * trip; the client merges by id, so a message delivered twice lands once.
 */
export async function messagesSince(
  conversationId: string,
  afterSeq: number,
  since?: Date
): Promise<ChatMessage[]> {
  const fresh = gt(messages.seq, afterSeq)
  const changed = since ? gt(messages.updatedAt, since) : undefined

  const scope = changed ? or(fresh, changed) : fresh

  const rows = await selectMessages()
    .where(and(eq(messages.conversationId, conversationId), scope))
    .orderBy(asc(messages.seq))
    .limit(200)

  return hydrate(rows, await quotesFor(rows), await proposalsFor(rows))
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export type SendInput = {
  conversationId: string
  /** Null when the assistant is speaking; it has no account. */
  senderId: string | null
  kind?: MessageKind
  body?: string
  assetId?: string | null
  durationSec?: number | null
  replyToId?: string | null
  fromAssistant?: boolean
  /** The message this answers, for a turn's provenance. */
  repliesToId?: string | null
}

/**
 * Appends a message and hands back its sequence number.
 *
 * The sequence is taken inside the transaction with a row lock, not from
 * `max(seq) + 1` read beforehand: two sends landing together would otherwise
 * both read the same number and one would be rejected by the unique index —
 * or worse, silently overwrite if that index were ever dropped.
 */
export async function sendMessage(input: SendInput): Promise<ChatMessage> {
  const kind = input.kind ?? 'TEXT'
  const body = (input.body ?? '').trim()

  if (kind === 'TEXT' && !body) {
    throw ApiError.badRequest('訊息不能是空的')
  }
  if (kind !== 'TEXT' && kind !== 'CALL' && !input.assetId) {
    throw ApiError.badRequest('這種訊息要附一個檔案')
  }

  if (input.assetId) {
    const [asset] = await db
      .select({ id: assets.id, status: assets.uploadStatus })
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .limit(1)

    if (!asset) throw ApiError.badRequest('找不到這個檔案')
    if (asset.status !== 'COMPLETED') throw new ApiError(409, '檔案還沒上傳完成', 'asset_incomplete')
  }

  if (input.replyToId) {
    const [target] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.id, input.replyToId), eq(messages.conversationId, input.conversationId))
      )
      .limit(1)

    if (!target) throw ApiError.badRequest('找不到要回覆的訊息')
  }

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(conversations)
      .set({ lastSeq: sql`${conversations.lastSeq} + 1`, updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId))
      .returning({ seq: conversations.lastSeq })

    if (!row) throw ApiError.notFound('找不到這個對話')

    const [created] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        senderId: input.senderId,
        seq: row.seq,
        kind,
        body,
        assetId: input.assetId ?? null,
        durationSec: input.durationSec ?? null,
        replyToId: input.replyToId ?? null,
        fromAssistant: input.fromAssistant ?? false,
        repliesToId: input.repliesToId ?? null,
      })
      .returning({ id: messages.id })

    if (!created) throw new ApiError(500, '送出失敗', 'message_create_failed')

    // The sender has by definition read their own message. The assistant has
    // no membership row, so there is nothing to move.
    if (input.senderId) {
      await tx
        .update(conversationMembers)
        .set({ readSeq: row.seq })
        .where(
          and(
            eq(conversationMembers.conversationId, input.conversationId),
            eq(conversationMembers.userId, input.senderId)
          )
        )
    }

    return created.id
  })

  const rows = await selectMessages().where(eq(messages.id, id))
  const [message] = hydrate(rows, await quotesFor(rows), await proposalsFor(rows))
  if (!message) throw new ApiError(500, '送出後讀不回來', 'message_read_failed')

  return message
}

/**
 * Takes a message back.
 *
 * The row stays with `body` cleared rather than being deleted: the other
 * person may already have it on screen, and a hole in the sequence would make
 * a reconnecting client believe it had missed something. Only the sender, and
 * only their own message.
 */
export async function recallMessage(messageId: string, userId: string): Promise<ChatMessage> {
  const [existing] = await db
    .select({ id: messages.id, senderId: messages.senderId, recalledAt: messages.recalledAt })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1)

  if (!existing) throw ApiError.notFound('找不到這則訊息')
  if (existing.senderId !== userId) throw ApiError.forbidden('只能收回自己送出的訊息')
  if (existing.recalledAt) return (await byId(messageId))!

  await db
    .update(messages)
    .set({ body: '', assetId: null, durationSec: null, recalledAt: new Date(), updatedAt: new Date() })
    .where(eq(messages.id, messageId))

  const message = await byId(messageId)
  if (!message) throw new ApiError(500, '收回後讀不回來', 'message_read_failed')
  return message
}

/** Edits a text message. Images and files are replaced, not edited. */
export async function editMessage(
  messageId: string,
  userId: string,
  body: string
): Promise<ChatMessage> {
  const next = body.trim()
  if (!next) throw ApiError.badRequest('訊息不能是空的')

  const [existing] = await db
    .select({ senderId: messages.senderId, kind: messages.kind, recalledAt: messages.recalledAt })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1)

  if (!existing) throw ApiError.notFound('找不到這則訊息')
  if (existing.senderId !== userId) throw ApiError.forbidden('只能編輯自己送出的訊息')
  if (existing.recalledAt) throw ApiError.badRequest('已收回的訊息不能編輯')
  if (existing.kind !== 'TEXT') throw ApiError.badRequest('只有文字訊息可以編輯')

  await db
    .update(messages)
    .set({ body: next, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(messages.id, messageId))

  const message = await byId(messageId)
  if (!message) throw new ApiError(500, '編輯後讀不回來', 'message_read_failed')
  return message
}

async function byId(messageId: string): Promise<ChatMessage | undefined> {
  const rows = await selectMessages().where(eq(messages.id, messageId))
  return hydrate(rows, await quotesFor(rows), await proposalsFor(rows))[0]
}

/* -------------------------------------------------------------------------- */
/* Read state and presence                                                     */
/* -------------------------------------------------------------------------- */

export async function markRead(conversationId: string, userId: string, seq: number): Promise<void> {
  await db
    .update(conversationMembers)
    .set({ readSeq: seq })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        // Never move the marker backwards: an older tab catching up would
        // otherwise mark already-read messages unread again.
        lt(conversationMembers.readSeq, seq)
      )
    )
}

/** Seconds of silence after which someone is no longer counted as online. */
export const ONLINE_WINDOW_SEC = 45
/** Typing fades faster than presence; a stale 「輸入中」 is a lie. */
export const TYPING_WINDOW_SEC = 8

export async function heartbeat(input: {
  userId: string
  typingInId?: string | null
}): Promise<void> {
  const now = new Date()

  await db
    .insert(presence)
    .values({
      userId: input.userId,
      lastSeenAt: now,
      typingInId: input.typingInId ?? null,
      typingAt: input.typingInId ? now : null,
    })
    .onConflictDoUpdate({
      target: presence.userId,
      set: {
        lastSeenAt: now,
        typingInId: input.typingInId ?? null,
        typingAt: input.typingInId ? now : null,
      },
    })
}

export type MemberState = {
  userId: string
  name: string
  title: string
  color: string
  online: boolean
  lastSeenAt: Date | null
  typing: boolean
  readSeq: number
}

export async function conversationState(conversationId: string): Promise<{
  lastSeq: number
  members: MemberState[]
}> {
  const [conversation] = await db
    .select({ lastSeq: conversations.lastSeq })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      title: users.title,
      color: users.color,
      readSeq: conversationMembers.readSeq,
      lastSeenAt: presence.lastSeenAt,
      typingInId: presence.typingInId,
      typingAt: presence.typingAt,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .leftJoin(presence, eq(presence.userId, users.id))
    .where(eq(conversationMembers.conversationId, conversationId))

  const now = Date.now()

  return {
    lastSeq: conversation?.lastSeq ?? 0,
    members: rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      title: row.title,
      color: row.color,
      readSeq: row.readSeq,
      lastSeenAt: row.lastSeenAt ?? null,
      online: row.lastSeenAt
        ? now - row.lastSeenAt.getTime() < ONLINE_WINDOW_SEC * 1000
        : false,
      typing:
        row.typingInId === conversationId &&
        Boolean(row.typingAt) &&
        now - (row.typingAt?.getTime() ?? 0) < TYPING_WINDOW_SEC * 1000,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* 通話 (Z99)                                                                   */
/* -------------------------------------------------------------------------- */

export type CallState = 'RINGING' | 'ACTIVE' | 'ENDED' | 'MISSED' | 'DECLINED'

export type CallRow = {
  id: string
  conversationId: string
  callerId: string | null
  video: boolean
  state: CallState
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
}

/**
 * Starts a call and returns it ringing.
 *
 * The WebRTC handshake does not happen here — the browsers do that between
 * themselves, with this server only passing the envelopes. What this row is
 * for is the part peer-to-peer cannot do: telling the other person their phone
 * should be ringing.
 */
/** A ringing call nobody answered. After this it is a missed call. */
const RING_TIMEOUT_MS = 60_000
/**
 * How long a call may stay ACTIVE without anyone ending it.
 *
 * A browser that crashes, loses power or is force-quit never sends the PATCH
 * that ends the call, so the row stays ACTIVE forever — and because only one
 * live call is allowed per conversation, that one stuck row blocks every
 * future call with 「已經有一通進行中的通話」 and no way to clear it from
 * the UI. Four hours is longer than any call these two will have.
 */
const CALL_MAX_MS = 4 * 60 * 60 * 1000

/**
 * Closes calls that were left hanging, and returns how many.
 *
 * Runs before every dial rather than on a schedule: there is no cron for this
 * and the only moment it matters is when someone is trying to call.
 */
async function expireStaleCalls(conversationId: string): Promise<void> {
  const now = Date.now()

  const live = await db
    .select({
      id: calls.id,
      state: calls.state,
      createdAt: calls.createdAt,
      startedAt: calls.startedAt,
    })
    .from(calls)
    .where(
      and(eq(calls.conversationId, conversationId), inArray(calls.state, ['RINGING', 'ACTIVE']))
    )

  for (const call of live) {
    const ringingTooLong =
      call.state === 'RINGING' && now - call.createdAt.getTime() > RING_TIMEOUT_MS
    const activeTooLong =
      call.state === 'ACTIVE' &&
      now - (call.startedAt ?? call.createdAt).getTime() > CALL_MAX_MS

    if (!ringingTooLong && !activeTooLong) continue

    await db
      .update(calls)
      .set({ state: ringingTooLong ? 'MISSED' : 'ENDED', endedAt: new Date() })
      .where(eq(calls.id, call.id))
  }
}

export async function startCall(input: {
  conversationId: string
  callerId: string
  video: boolean
}): Promise<CallRow> {
  await expireStaleCalls(input.conversationId)

  // One live call per conversation. A second would have both sides negotiating
  // two peer connections and hearing neither.
  const [existing] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(
        eq(calls.conversationId, input.conversationId),
        inArray(calls.state, ['RINGING', 'ACTIVE'])
      )
    )
    .limit(1)

  if (existing) throw new ApiError(409, '這個對話已經有一通進行中的通話', 'call_in_progress')

  const [row] = await db
    .insert(calls)
    .values({
      conversationId: input.conversationId,
      callerId: input.callerId,
      video: input.video ? 'true' : 'false',
    })
    .returning()

  if (!row) throw new ApiError(500, '撥號失敗', 'call_create_failed')
  return toCallRow(row)
}

export async function setCallState(
  callId: string,
  userId: string,
  state: CallState
): Promise<CallRow> {
  const [existing] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1)
  if (!existing) throw ApiError.notFound('找不到這通通話')

  await assertMember(existing.conversationId, userId)

  const now = new Date()
  const [row] = await db
    .update(calls)
    .set({
      state,
      ...(state === 'ACTIVE' && !existing.startedAt ? { startedAt: now } : {}),
      ...(state === 'ENDED' || state === 'DECLINED' || state === 'MISSED'
        ? { endedAt: now }
        : {}),
    })
    .where(eq(calls.id, callId))
    .returning()

  if (!row) throw new ApiError(500, '更新通話狀態失敗', 'call_update_failed')

  /*
   * A finished call leaves a line in the thread, the way a phone leaves a log.
   * Written here rather than by the client so it lands exactly once however
   * many tabs were open.
   */
  /*
   * Only once. Two tabs hanging up together, or a hang-up racing the other
   * side's, would otherwise each write a 「通話結束」 line.
   */
  const alreadyClosed =
    existing.state === 'ENDED' || existing.state === 'MISSED' || existing.state === 'DECLINED'

  if (!alreadyClosed && (state === 'ENDED' || state === 'MISSED' || state === 'DECLINED')) {
    const seconds =
      row.startedAt && row.endedAt
        ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000))
        : 0

    const label =
      state === 'ENDED'
        ? `${row.video === 'true' ? '視訊' : '語音'}通話・${formatCallLength(seconds)}`
        : state === 'DECLINED'
          ? '通話已拒接'
          : '未接來電'

    await sendMessage({
      conversationId: row.conversationId,
      senderId: row.callerId ?? userId,
      kind: 'CALL',
      body: label,
    })
  }

  return toCallRow(row)
}

function formatCallLength(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}

function toCallRow(row: typeof calls.$inferSelect): CallRow {
  return {
    id: row.id,
    conversationId: row.conversationId,
    callerId: row.callerId,
    video: row.video === 'true',
    state: row.state as CallState,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  }
}

/**
 * The most recent call in this conversation, whatever state it is in.
 *
 * Deliberately not "the live one". A hang-up has to reach the other side, and
 * the only way to say 「你那通電話結束了」 is to name it — a bare null says
 * 「現在沒有通話」, which is also true a second before someone dials and
 * would tear down a call that was still being set up.
 *
 * Old calls are cheap to send: the row is small and only goes out when its
 * state changes.
 */
export async function activeCall(conversationId: string): Promise<CallRow | null> {
  const [row] = await db
    .select()
    .from(calls)
    .where(eq(calls.conversationId, conversationId))
    .orderBy(desc(calls.createdAt))
    .limit(1)

  return row ? toCallRow(row) : null
}

/**
 * Queues one SDP or ICE payload for the other side.
 *
 * Stored rather than forwarded because the SSE connection drops every minute
 * on Vercel; a candidate that arrived during a reconnect would vanish, and the
 * call would fail with no error anyone could act on.
 */
export async function pushSignal(input: {
  callId: string
  fromUserId: string
  kind: string
  payload: string
}): Promise<void> {
  const [call] = await db.select().from(calls).where(eq(calls.id, input.callId)).limit(1)
  if (!call) throw ApiError.notFound('找不到這通通話')

  await assertMember(call.conversationId, input.fromUserId)

  const others = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, call.conversationId))

  await db.insert(callSignals).values(
    others
      .filter((row) => row.userId !== input.fromUserId)
      .map((row) => ({
        callId: input.callId,
        fromUserId: input.fromUserId,
        toUserId: row.userId,
        kind: input.kind,
        payload: input.payload,
      }))
  )
}

/** Takes this member's queued signals and removes them. Delivered once. */
export async function drainSignals(userId: string): Promise<
  { id: string; callId: string; kind: string; payload: string }[]
> {
  const rows = await db
    .select({
      id: callSignals.id,
      callId: callSignals.callId,
      kind: callSignals.kind,
      payload: callSignals.payload,
    })
    .from(callSignals)
    .where(eq(callSignals.toUserId, userId))
    .orderBy(asc(callSignals.createdAt))
    .limit(50)

  if (rows.length > 0) {
    await db.delete(callSignals).where(
      inArray(
        callSignals.id,
        rows.map((row) => row.id)
      )
    )
  }

  return rows
}
