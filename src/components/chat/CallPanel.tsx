'use client'

import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ChannelCall, ChannelSignal } from '@/components/chat/useChatChannel'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * 語音／視訊通話 (Z99).
 *
 * WebRTC peer-to-peer: the media never touches this server, which is the only
 * way a two-person studio can afford video at all — relaying it would be
 * bandwidth billed per minute.
 *
 * What the server does carry is the handshake, over the same SSE channel as
 * messages. The envelopes are stored before delivery rather than forwarded,
 * because that connection drops every minute on Vercel and an ICE candidate
 * lost in a reconnect fails the call with no error anyone can act on.
 *
 * STUN only, from Google's public servers. That connects two ordinary home
 * networks. It does **not** connect two symmetric NATs — some mobile carriers
 * and corporate networks — and there is no TURN server configured, so that
 * case fails. The panel says so rather than spinning: a call that never
 * connects and never explains itself is the worst version of this.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

type Phase = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'failed'

export function CallPanel({
  conversationId,
  meId,
  partnerName,
  call,
  setCall,
  signalQueue,
}: {
  conversationId: string
  meId: string
  partnerName: string
  call: ChannelCall | null
  setCall: (call: ChannelCall | null) => void
  /** Filled by the SSE channel; drained here. */
  signalQueue: MutableRefObject<ChannelSignal[]>
}) {
  const toast = useToast()

  const [phase, setPhase] = useState<Phase>('idle')
  const [withVideo, setWithVideo] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const peerRef = useRef<RTCPeerConnection | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const callIdRef = useRef<string | null>(null)
  /** Candidates that arrive before the remote description is set. */
  const pendingIce = useRef<RTCIceCandidateInit[]>([])

  /* ----------------------------------------------------------------- setup */

  const teardown = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null

    for (const track of localRef.current?.getTracks() ?? []) track.stop()
    localRef.current = null

    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null

    callIdRef.current = null
    pendingIce.current = []
    setPhase('idle')
    setElapsed(0)
    setMuted(false)
    setCameraOff(false)
  }, [])

  useEffect(() => () => teardown(), [teardown])

  const sendSignal = useCallback(async (callId: string, kind: string, payload: unknown) => {
    await apiFetch(`/api/chat/calls/${callId}/signal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId, kind, payload: JSON.stringify(payload) }),
    }).catch(() => {})
  }, [])

  const buildPeer = useCallback(
    async (callId: string, video: boolean) => {
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      peerRef.current = peer

      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video })
      localRef.current = media
      for (const track of media.getTracks()) peer.addTrack(track, media)

      if (localVideoRef.current) localVideoRef.current.srcObject = media

      peer.ontrack = (event) => {
        const [stream] = event.streams
        if (stream && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream
      }

      peer.onicecandidate = (event) => {
        if (event.candidate) void sendSignal(callId, 'ice', event.candidate.toJSON())
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setPhase('active')
        if (peer.connectionState === 'failed') {
          /*
           * Almost always a NAT that STUN cannot traverse. Saying which is
           * better than "通話失敗" — the fix is a TURN server, and nobody can
           * act on an error that does not name it.
           */
          setProblem(
            '接不通：雙方的網路環境需要中繼伺服器（TURN）。目前只設定了 STUN，一般家用網路可以，行動網路或公司網路常常不行。'
          )
          setPhase('failed')
        }
      }

      return peer
    },
    [sendSignal]
  )

  /* ------------------------------------------------------------ signalling */

  useEffect(() => {
    const drain = window.setInterval(() => {
      const signals = signalQueue.current
      if (signals.length === 0) return
      signalQueue.current = []

      for (const signal of signals) void handle(signal)
    }, 300)

    async function handle(signal: ChannelSignal) {
      const peer = peerRef.current
      if (!peer) return

      try {
        const payload = JSON.parse(signal.payload)

        if (signal.kind === 'answer') {
          await peer.setRemoteDescription(new RTCSessionDescription(payload))
          // Candidates that beat the answer here were parked; replay them now
          // that there is something to attach them to.
          for (const candidate of pendingIce.current) await peer.addIceCandidate(candidate)
          pendingIce.current = []
        } else if (signal.kind === 'offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(payload))
          for (const candidate of pendingIce.current) await peer.addIceCandidate(candidate)
          pendingIce.current = []

          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          await sendSignal(signal.callId, 'answer', answer)
        } else if (signal.kind === 'ice') {
          if (peer.remoteDescription) await peer.addIceCandidate(payload)
          else pendingIce.current.push(payload)
        }
      } catch {
        // A malformed or out-of-order envelope must not take the call down;
        // ICE retries, and a genuinely broken handshake ends in `failed`.
      }
    }

    return () => window.clearInterval(drain)
  }, [signalQueue, sendSignal])

  /* -------------------------------------------------------- incoming calls */

  /*
   * `call` arrives from the stream, which is an external source — so the
   * reaction is an effect, but the state changes are queued rather than
   * written synchronously. Writing them in the effect body is what
   * `react-hooks/set-state-in-effect` forbids, and here it would also fight
   * the phase the local user just set by pressing a button.
   */
  const callStateRef = useRef<string | null>(null)

  useEffect(() => {
    const signature = call ? `${call.id}:${call.state}` : 'none'
    if (callStateRef.current === signature) return
    callStateRef.current = signature

    const timer = window.setTimeout(() => {
      if (!call) return

      if (call.state === 'RINGING' && call.callerId !== meId) {
        callIdRef.current = call.id
        setWithVideo(call.video)
        setPhase((current) => (current === 'idle' ? 'incoming' : current))
      }

      if (call.state === 'ENDED' || call.state === 'DECLINED' || call.state === 'MISSED') {
        teardown()
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [call, meId, teardown])

  /* ------------------------------------------------------------- the clock */

  useEffect(() => {
    if (phase !== 'active') return
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  /* --------------------------------------------------------------- actions */

  async function dial(video: boolean) {
    setProblem(null)
    setWithVideo(video)
    setPhase('ringing')

    try {
      const response = await apiFetch('/api/chat/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, video }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { call: ChannelCall }
      callIdRef.current = body.call.id
      setCall(body.call)

      const peer = await buildPeer(body.call.id, video)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await sendSignal(body.call.id, 'offer', offer)
    } catch (cause) {
      teardown()
      toast.error('撥號失敗', cause instanceof Error ? cause.message : undefined)
    }
  }

  async function answer() {
    const callId = callIdRef.current
    if (!callId) return

    setPhase('connecting')
    try {
      // The peer is built before the state change, so an offer arriving in the
      // same tick has something to be applied to.
      await buildPeer(callId, withVideo)
      await apiFetch(`/api/chat/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'ACTIVE' }),
      })
    } catch (cause) {
      teardown()
      toast.error('接聽失敗', cause instanceof Error ? cause.message : undefined)
    }
  }

  async function hangUp(state: 'ENDED' | 'DECLINED' = 'ENDED') {
    const callId = callIdRef.current
    teardown()
    setCall(null)

    if (!callId) return
    await apiFetch(`/api/chat/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    }).catch(() => {})
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    for (const track of localRef.current?.getAudioTracks() ?? []) track.enabled = !next
  }

  function toggleCamera() {
    const next = !cameraOff
    setCameraOff(next)
    for (const track of localRef.current?.getVideoTracks() ?? []) track.enabled = !next
  }

  /* ---------------------------------------------------------------- render */

  const live = phase !== 'idle'

  return (
    <>
      <button
        type="button"
        onClick={() => void dial(false)}
        disabled={live}
        aria-label="語音通話"
        title="語音通話"
        className="grid size-9 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
      >
        <Phone aria-hidden className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => void dial(true)}
        disabled={live}
        aria-label="視訊通話"
        title="視訊通話"
        className="grid size-9 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40"
      >
        <Video aria-hidden className="size-4" />
      </button>

      {live && (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-80">
          <div className="panel flex flex-col gap-3 rounded-t-2xl bg-stage-850 p-4 ring-1 shadow-2xl ring-stage-700 sm:rounded-2xl">
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs font-medium text-ink-50">{partnerName}</span>
                <span className="text-[10px] text-ink-500 tabular-nums">
                  {phase === 'ringing'
                    ? '撥號中⋯'
                    : phase === 'incoming'
                      ? `${withVideo ? '視訊' : '語音'}來電`
                      : phase === 'connecting'
                        ? '連線中⋯'
                        : phase === 'failed'
                          ? '接不通'
                          : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
                </span>
              </span>
            </div>

            {withVideo && (phase === 'active' || phase === 'connecting') && (
              <div className="relative overflow-hidden rounded-xl bg-black">
                { }
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="aspect-video w-full object-cover"
                />
                {/* `muted` on the local preview, or you hear yourself. */}
                { }
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute right-2 bottom-2 w-20 rounded-lg ring-1 ring-white/20"
                />
              </div>
            )}

            {!withVideo && (
              // The audio still needs an element to play through, even with
              // nothing to look at.
               
              <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
            )}

            {problem && (
              <p role="alert" className="text-[10px] leading-relaxed text-amber-300">
                {problem}
              </p>
            )}

            <div className="flex items-center justify-center gap-2">
              {phase === 'incoming' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void hangUp('DECLINED')}
                    className="grid size-11 place-items-center rounded-full bg-rose-500 text-white"
                    aria-label="拒接"
                  >
                    <PhoneOff aria-hidden className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void answer()}
                    className="grid size-11 place-items-center rounded-full bg-emerald-500 text-white"
                    aria-label="接聽"
                  >
                    <Phone aria-hidden className="size-5" />
                  </button>
                </>
              ) : (
                <>
                  <CallButton label={muted ? '取消靜音' : '靜音'} active={muted} onClick={toggleMute}>
                    {muted ? (
                      <MicOff aria-hidden className="size-4" />
                    ) : (
                      <Mic aria-hidden className="size-4" />
                    )}
                  </CallButton>

                  {withVideo && (
                    <CallButton
                      label={cameraOff ? '開啟鏡頭' : '關閉鏡頭'}
                      active={cameraOff}
                      onClick={toggleCamera}
                    >
                      {cameraOff ? (
                        <VideoOff aria-hidden className="size-4" />
                      ) : (
                        <Video aria-hidden className="size-4" />
                      )}
                    </CallButton>
                  )}

                  <button
                    type="button"
                    onClick={() => void hangUp()}
                    className="grid size-11 place-items-center rounded-full bg-rose-500 text-white"
                    aria-label="掛斷"
                  >
                    <PhoneOff aria-hidden className="size-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CallButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'grid size-9 place-items-center rounded-full transition-colors',
        active ? 'bg-ink-200 text-stage-900' : 'bg-stage-800 text-ink-200 hover:bg-stage-700'
      )}
    >
      {children}
    </button>
  )
}
