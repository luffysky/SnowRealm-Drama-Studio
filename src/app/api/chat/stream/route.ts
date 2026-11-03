import {
  activeCall,
  assertMember,
  conversationState,
  drainSignals,
  messagesSince,
  openDirectConversation,
} from '@/lib/chat'
import { STREAM_LIFETIME_MS } from '@/lib/chat-view'
import { requireUser } from '@/lib/api'

export const runtime = 'nodejs'
/*
 * Long-lived response. Vercel Hobby cuts a function at 60 seconds, which is
 * why the stream closes itself at 50 — see `STREAM_LIFETIME_MS`.
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * The live channel (Z99).
 *
 * Server-Sent Events rather than a WebSocket, because Vercel cannot hold one
 * open. SSE is one-directional, which is fine: everything the client *sends*
 * is an ordinary POST, and what it needs to *hear* is a stream of changes.
 *
 * The connection closes itself before the platform kills it. A socket killed
 * by the platform surfaces in the browser as a network error; closing first
 * lets EventSource's own retry take over quietly.
 *
 * It polls the database rather than listening on it: `LISTEN/NOTIFY` needs a
 * dedicated connection, which a serverless function cannot keep either. The
 * poll is cheap — one indexed query against `(conversation_id, seq)` — and it
 * is the same query the fallback path uses, so there is one protocol and not
 * two.
 */
export async function GET(request: Request) {
  const user = await requireUser()

  const url = new URL(request.url)
  const conversationId = url.searchParams.get('conversation') ?? (await openDirectConversation(user.id))
  await assertMember(conversationId, user.id)

  let cursor = Number(url.searchParams.get('since') ?? 0)
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0

  /*
   * A second cursor, for messages that changed rather than arrived — a
   * recall or an edit does not move `seq`, so the sequence cursor alone
   * never carried them and the other side had to reload.
   *
   * Starts a few seconds back so a reconnect does not miss a change made
   * during the gap.
   */
  let changedSince = new Date(Date.now() - 10_000)

  /** Last call state sent, so an unchanged one is not resent every tick. */
  let lastCall = ''

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      // Tell the client how long this connection will live, so it can plan the
      // reconnect rather than discovering it as a failure.
      send('open', { conversationId, lifetimeMs: STREAM_LIFETIME_MS })

      /*
       * Two rhythms, because the two reads cost very different amounts.
       *
       * Messages and call signals are single indexed lookups, so they run
       * often — that interval *is* the delivery latency, and at 1500ms a
       * message took 2.4 seconds to arrive, which does not read as instant.
       *
       * Presence joins `users` and `presence` and is only interesting at
       * human timescales: nobody notices a typing indicator 2 seconds late,
       * and running it at the fast rate tripled the query cost of an idle
       * connection for no gain.
       */
      const fast = async () => {
        if (closed) return
        try {
          const askedAt = new Date()
          const fresh = await messagesSince(conversationId, cursor, changedSince)

          if (fresh.length > 0) {
            // `seq` only moves forward for genuinely new messages; a recall
            // replayed from the past must not drag the cursor backwards.
            cursor = Math.max(cursor, ...fresh.map((m) => m.seq))
            send('messages', fresh)
          }
          changedSince = askedAt

          /*
           * The call handshake rides the same channel. A second transport for
           * a handful of payloads exchanged once per call would be a second
           * thing to reconnect, and the reconnect is the hard part here.
           */
          const signals = await drainSignals(user.id)
          if (signals.length > 0) send('signals', signals)
        } catch {
          // A transient database error must not kill the stream; the next
          // tick retries, and a persistent one ends with the lifetime timer.
        }
      }

      const slow = async () => {
        if (closed) return
        try {
          send('state', await conversationState(conversationId))

          /*
           * Sent even when there is no call, because that *is* the news.
           *
           * `activeCall` only returns a RINGING or ACTIVE one, so hanging up
           * made it null — and guarding on `if (call)` meant the event was
           * never sent at all. The other side sat in a call that had ended,
           * with its timer still running, until it reloaded.
           *
           * Only on a change, so an idle conversation is not sending a null
           * twice a second for the lifetime of the connection.
           */
          const call = await activeCall(conversationId)
          const signature = call ? `${call.id}:${call.state}` : 'none'
          if (signature !== lastCall) {
            lastCall = signature
            send('call', call)
          }
        } catch {
          // Same reasoning as above.
        }
      }

      await Promise.all([fast(), slow()])
      const poll = setInterval(() => void fast(), 700)
      const slowPoll = setInterval(() => void slow(), 2500)

      const stop = () => {
        if (closed) return
        closed = true
        clearInterval(poll)
        clearInterval(slowPoll)
        clearTimeout(lifetime)
        try {
          controller.close()
        } catch {
          // Already closed by the client going away.
        }
      }

      const lifetime = setTimeout(() => {
        send('bye', { reason: 'lifetime', since: cursor })
        stop()
      }, STREAM_LIFETIME_MS)

      request.signal.addEventListener('abort', stop)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and some proxies buffer a response until it ends, which would
      // make every message arrive at once when the stream closed.
      'x-accel-buffering': 'no',
    },
  })
}
