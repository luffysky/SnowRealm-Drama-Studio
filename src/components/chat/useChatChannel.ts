'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/client-fetch'
import { HEARTBEAT_MS, POLL_MS } from '@/lib/chat-view'

/**
 * The live connection (Z99).
 *
 * Server-Sent Events, with polling behind it. Vercel cannot hold a WebSocket
 * open, and it cuts any function at 60 seconds — so the stream closes itself
 * at 50 and `EventSource` reconnects on its own. Both paths ask the same
 * question, "everything above this sequence number", which is why a failover
 * mid-conversation loses nothing: the cursor is the whole protocol.
 *
 * Polling is not a lesser mode kept for old browsers. It is what runs whenever
 * the stream has failed twice in a row, so a proxy that buffers SSE — some
 * corporate and hotel networks do — degrades to a slower chat rather than a
 * silent one.
 */

export type ChannelMessage = {
  id: string
  seq: number
  conversationId: string
  senderId: string | null
  senderName: string
  senderColor: string
  fromAssistant: boolean
  /** Edits the assistant proposed in this reply; decided by a person. */
  proposals?: {
    id: string
    targetType: string
    targetId: string
    field: string
    beforeValue: string
    afterValue: string
    rationale: string
    state: string
    stale: boolean
  }[]
  kind: string
  body: string
  assetId: string | null
  assetName: string | null
  assetMime: string | null
  assetSize: number | null
  durationSec: number | null
  replyToId: string | null
  replyToBody: string | null
  replyToSender: string | null
  recalledAt: string | null
  editedAt: string | null
  createdAt: string
}

export type ChannelMember = {
  userId: string
  name: string
  title: string
  color: string
  online: boolean
  lastSeenAt: string | null
  typing: boolean
  readSeq: number
}

export type ChannelCall = {
  id: string
  conversationId: string
  callerId: string | null
  video: boolean
  state: 'RINGING' | 'ACTIVE' | 'ENDED' | 'MISSED' | 'DECLINED'
  startedAt: string | null
  endedAt: string | null
}

export type ChannelSignal = { id: string; callId: string; kind: string; payload: string }

export type ChannelStatus = 'connecting' | 'live' | 'polling' | 'offline'

export function useChatChannel({
  conversationId,
  initialMessages,
  initialSeq,
  onSignals,
}: {
  conversationId: string
  initialMessages: ChannelMessage[]
  initialSeq: number
  /** WebRTC envelopes, handed straight to the call layer. */
  onSignals?: (signals: ChannelSignal[]) => void
}) {
  const [messages, setMessages] = useState<ChannelMessage[]>(initialMessages)
  const [members, setMembers] = useState<ChannelMember[]>([])
  const [call, setCall] = useState<ChannelCall | null>(null)
  const [status, setStatus] = useState<ChannelStatus>('connecting')

  // Refs, not state: the stream callbacks close over these and must see the
  // current value without the effect being torn down and rebuilt each time.
  const cursorRef = useRef(initialSeq)
  /**
   * Recalls and edits do not move `seq`; this is how they are picked up.
   *
   * Seeded with the epoch rather than `Date.now()` — reading the clock during
   * render is impure, and the first poll overwrites it with the server's own
   * timestamp anyway, which is the one that matters when the two clocks
   * disagree.
   */
  const changedRef = useRef('1970-01-01T00:00:00.000Z')
  const failuresRef = useRef(0)
  const signalsRef = useRef(onSignals)

  /*
   * Written in an effect, not during render: React may render without
   * committing, and a ref updated on a discarded render would hold a callback
   * from a tree that never mounted.
   */
  useEffect(() => {
    signalsRef.current = onSignals
  }, [onSignals])

  /** Merges by `seq`, so a message arriving twice lands once. */
  const absorb = useCallback((incoming: ChannelMessage[]) => {
    if (incoming.length === 0) return

    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]))
      for (const message of incoming) byId.set(message.id, message)
      return [...byId.values()].sort((a, b) => a.seq - b.seq)
    })

    // Never backwards: a recall replayed from the past carries an old `seq`.
    const highest = incoming.reduce((max, m) => (m.seq > max ? m.seq : max), cursorRef.current)
    cursorRef.current = highest
  }, [])

  /** Replaces one message in place — an edit or a recall, not a new arrival. */
  const replace = useCallback((message: ChannelMessage) => {
    setMessages((current) => current.map((m) => (m.id === message.id ? message : m)))
  }, [])

  /* ------------------------------------------------------------- transport */

  useEffect(() => {
    let cancelled = false
    let source: EventSource | null = null
    let pollTimer: number | null = null
    let reopenTimer: number | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const response = await apiFetch(
          `/api/chat/messages?conversation=${conversationId}` +
            `&since=${cursorRef.current}&changedAfter=${encodeURIComponent(changedRef.current)}`
        )
        if (!response.ok) throw new Error(String(response.status))

        const body = (await response.json()) as { messages: ChannelMessage[]; at?: string }
        absorb(body.messages)
        if (body.at) changedRef.current = body.at
        setStatus('polling')
      } catch {
        setStatus('offline')
      }
    }

    const startPolling = () => {
      if (pollTimer !== null) return
      setStatus('polling')
      void poll()
      pollTimer = window.setInterval(() => void poll(), POLL_MS)
    }

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const open = () => {
      if (cancelled) return

      /*
       * `EventSource` has no header API, so the session cookie does the
       * authenticating — which it can, because this is same-origin.
       */
      source = new EventSource(
        `/api/chat/stream?conversation=${conversationId}&since=${cursorRef.current}`
      )

      source.addEventListener('open', () => {
        failuresRef.current = 0
        stopPolling()
        setStatus('live')
      })

      source.addEventListener('messages', (event) => {
        absorb(JSON.parse((event as MessageEvent).data) as ChannelMessage[])
      })

      source.addEventListener('state', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as {
          lastSeq: number
          members: ChannelMember[]
        }
        setMembers(data.members)
      })

      source.addEventListener('call', (event) => {
        // `null` is a real value here: it means the call ended.
        setCall(JSON.parse((event as MessageEvent).data) as ChannelCall | null)
      })

      source.addEventListener('signals', (event) => {
        const signals = JSON.parse((event as MessageEvent).data) as ChannelSignal[]
        signalsRef.current?.(signals)
      })

      /*
       * The server says goodbye before the platform kills it. Reopening here,
       * rather than letting the error path handle it, keeps a scheduled
       * rollover from counting as a failure.
       */
      source.addEventListener('bye', () => {
        source?.close()
        source = null
        reopenTimer = window.setTimeout(open, 50)
      })

      source.addEventListener('error', () => {
        source?.close()
        source = null
        failuresRef.current += 1

        /*
         * Two failures and the stream is not coming back on this network —
         * a buffering proxy, or SSE blocked outright. Polling from here.
         */
        if (failuresRef.current >= 2) {
          startPolling()
          return
        }

        setStatus('connecting')
        reopenTimer = window.setTimeout(open, 1000 * failuresRef.current)
      })
    }

    if (typeof EventSource === 'undefined') startPolling()
    else open()

    return () => {
      cancelled = true
      source?.close()
      stopPolling()
      if (reopenTimer !== null) window.clearTimeout(reopenTimer)
    }
  }, [conversationId, absorb])

  /* ------------------------------------------------------------ heartbeat */

  useEffect(() => {
    const beat = (typing: boolean) => {
      void apiFetch('/api/chat/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, typing }),
      }).catch(() => {})
    }

    beat(false)
    const timer = window.setInterval(() => beat(false), HEARTBEAT_MS)

    /*
     * One last beat on the way out, with `keepalive` so it survives the page
     * unloading. Without it someone shows as online for the next 45 seconds
     * after closing the tab.
     */
    const leave = () => {
      navigator.sendBeacon?.(
        '/api/chat/presence',
        new Blob([JSON.stringify({ conversationId, typing: false, leaving: true })], {
          type: 'application/json',
        })
      )
    }
    window.addEventListener('pagehide', leave)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', leave)
    }
  }, [conversationId])

  const setTyping = useCallback(
    (typing: boolean) => {
      void apiFetch('/api/chat/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, typing }),
      }).catch(() => {})
    },
    [conversationId]
  )

  return { messages, setMessages, members, call, setCall, status, absorb, replace, setTyping }
}
