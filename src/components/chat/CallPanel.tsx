'use client'

import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, Volume1, Volume2 } from 'lucide-react'
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

type Phase = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'failed'

export function CallPanel({
  conversationId,
  meId,
  partnerName,
  call,
  setCall,
  signalQueue,
  iceServers,
}: {
  conversationId: string
  meId: string
  partnerName: string
  call: ChannelCall | null
  setCall: (call: ChannelCall | null) => void
  /** Filled by the SSE channel; drained here. */
  signalQueue: MutableRefObject<ChannelSignal[]>
  /**
   * From `app_settings`. Hardcoding these meant that adding a TURN server —
   * the one fix for a call that genuinely cannot be traversed — required a
   * redeploy, and the credentials would have lived in the repository.
   */
  iceServers: RTCIceServer[]
}) {
  const toast = useToast()

  const [phase, setPhase] = useState<Phase>('idle')
  const [withVideo, setWithVideo] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [volume, setVolume] = useState(1)
  const [speaker, setSpeaker] = useState(false)
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  /** Live handshake state, shown while connecting and after a failure. */
  const [trace, setTrace] = useState('')

  const peerRef = useRef<RTCPeerConnection | null>(null)
  /** Set by the signalling effect; called once a peer exists. */
  const replayRef = useRef<(() => void) | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  /** ICE candidates by type, so a failure can be diagnosed rather than guessed. */
  const candidates = useRef({ total: 0, host: 0, srflx: 0, relay: 0 })
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
    remoteStreamRef.current = null
    candidates.current = { total: 0, host: 0, srflx: 0, relay: 0 }
    setLocalStream(null)
    setRemoteStream(null)
    setSpeaker(false)
    setVolume(1)
    setTrace('')
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
      const peer = new RTCPeerConnection({ iceServers })
      peerRef.current = peer

      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video })
      localRef.current = media
      for (const track of media.getTracks()) peer.addTrack(track, media)

      /*
       * The streams are kept in refs and attached by an effect, not here.
       *
       * This ran while the phase was still 'ringing', when the preview
       * element had not been rendered yet — so `localVideoRef.current` was
       * null and the camera light came on with nothing on screen. Same for
       * the remote stream, which can arrive before the panel switches to
       * 'active'.
       */
      setLocalStream(media)

      peer.ontrack = (event) => {
        const [stream] = event.streams
        if (stream) {
          remoteStreamRef.current = stream
          setRemoteStream(stream)
        }
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) return

        // Count by type, for the diagnosis above.
        const type = event.candidate.type
        candidates.current.total += 1
        if (type === 'host') candidates.current.host += 1
        if (type === 'srflx') candidates.current.srflx += 1
        if (type === 'relay') candidates.current.relay += 1

        void sendSignal(callId, 'ice', event.candidate.toJSON())
      }

      /*
       * Diagnose, do not guess.
       *
       * The first version blamed every failure on NAT and told people to set
       * up a TURN server. That is wrong most of the time: if the handshake
       * never completed there is nothing for ICE to do, and two machines on
       * one home network do not need STUN at all, let alone a relay. Sending
       * someone to configure a relay they do not need — and which costs money
       * — is worse than saying nothing.
       *
       * `signalingState` separates the two cases cleanly: still holding an
       * offer or an answer means the other side never replied, which is a
       * signalling problem. 'stable' means both descriptions are in and the
       * failure really is the network between them.
       */
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setProblem(null)
          setPhase('active')
        }

        if (peer.connectionState === 'failed') {
          const signalling = peer.signalingState
          const ice = peer.iceConnectionState

          if (signalling !== 'stable') {
            setProblem(
              `握手沒有完成（signalingState=${signalling}）。` +
                '對方沒有回應 —— 通常是對方沒有真的接起來，或是兩邊版本不一致。重新整理兩邊的頁面再試一次。'
            )
          } else if (candidates.current.relay === 0 && candidates.current.srflx === 0) {
            setProblem(
              '連一個對外位址都拿不到（沒有 srflx candidate）。' +
                'STUN 被擋了，或是網路沒有通。'
            )
          } else {
            setProblem(
              '雙方都拿到位址了但接不起來，這才是真的需要中繼伺服器（TURN）的情況。' +
                `（ice=${ice}、host=${candidates.current.host}、srflx=${candidates.current.srflx}）`
            )
          }

          setPhase('failed')
        }
      }

      /*
       * What kinds of address we managed to gather. `host` alone means the
       * same network; `srflx` means STUN answered; `relay` would mean TURN,
       * which is not configured. This is the difference between "the
       * handshake broke" and "the network genuinely cannot be traversed",
       * and without it the message above is a guess.
       */
      /*
       * A running trace of the handshake.
       *
       * Visible on screen because this is the one feature that cannot be
       * tested from one machine — it takes two people on two networks. When
       * it fails, the numbers here are what makes the report actionable
       * instead of 「通話沒成功」.
       */
      const retrace = () => {
        const c = candidates.current
        setTrace(
          `sig=${peer.signalingState} ice=${peer.iceConnectionState} ` +
            `conn=${peer.connectionState} host=${c.host} srflx=${c.srflx} relay=${c.relay}`
        )
      }

      peer.addEventListener('signalingstatechange', retrace)
      peer.addEventListener('iceconnectionstatechange', retrace)
      peer.addEventListener('connectionstatechange', retrace)
      peer.addEventListener('icegatheringstatechange', retrace)
      retrace()

      peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState === 'complete' && candidates.current.total === 0) {
          setProblem('沒有收集到任何連線位址。通常是網路或防火牆擋掉了 UDP。')
        }
      }

      // Anything that arrived while there was no peer to apply it to.
      replayRef.current?.()

      return peer
    },
    [sendSignal, iceServers]
  )

  /* ------------------------------------------------------------ signalling */

  /** Signals that arrived before `peerRef` existed. Replayed by `buildPeer`. */
  const parked = useRef<ChannelSignal[]>([])

  useEffect(() => {
    const drain = window.setInterval(() => {
      const signals = signalQueue.current
      if (signals.length === 0) return
      signalQueue.current = []

      for (const signal of signals) void handle(signal)
    }, 300)

    async function handle(signal: ChannelSignal) {
      const peer = peerRef.current

      /*
       * The callee has no peer connection until they press answer, but the
       * caller's offer arrives the moment they dial — and `drainSignals`
       * deletes it on delivery. Dropping it here meant the handshake never
       * started: the call rang, was answered, and sat at 「連線中」 forever
       * with nothing in any log.
       *
       * Park it instead, and replay once there is something to apply it to.
       */
      if (!peer) {
        parked.current.push(signal)
        return
      }

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

    replayRef.current = () => {
      const queued = parked.current
      parked.current = []
      for (const signal of queued) void handle(signal)
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
        return
      }

      /*
       * Only when it is *this* call that ended.
       *
       * The server reports the latest call whatever its state, so a finished
       * one keeps arriving after the fact. Tearing down on any ended call
       * would kill a new one the moment it was dialled, because the previous
       * call's ENDED row is still the most recent until the new row lands.
       */
      const ended =
        call.state === 'ENDED' || call.state === 'DECLINED' || call.state === 'MISSED'

      if (ended && callIdRef.current === call.id) teardown()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [call, meId, teardown])

  /* --------------------------------------------------------- media binding */

  /*
   * Attach the streams whenever both the stream and its element exist.
   *
   * Doing it inside `buildPeer` could not work: that runs before the phase
   * change that renders the elements. The camera would be on, the track
   * flowing, and the preview blank.
   */
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream, phase, withVideo])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
      // Autoplay with sound needs an explicit play() after a user gesture,
      // which answering or dialling already was.
      void remoteVideoRef.current.play().catch(() => {})
    }
  }, [remoteStream, phase, withVideo])

  /** The other side's volume. Local tracks are muted at the element anyway. */
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.volume = volume
  }, [volume, remoteStream, phase])

  /*
   * 擴音. `setSinkId` is behind a permissions prompt in some browsers and
   * missing entirely in Safari, so the control only appears when the browser
   * can actually honour it.
   */
  useEffect(() => {
    if (phase === 'idle') return

    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => setOutputs(devices.filter((d) => d.kind === 'audiooutput')))
      .catch(() => setOutputs([]))
  }, [phase])

  useEffect(() => {
    const el = remoteVideoRef.current as (HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>
    }) | null
    if (!el?.setSinkId || outputs.length === 0) return

    /*
     * There is no "loudspeaker" device id on the web. The closest honest
     * thing is: speakerphone means the default output, and off means whatever
     * else is attached (a headset). With only one output the toggle is hidden.
     */
    const target = speaker
      ? outputs.find((d) => d.deviceId === 'default') ?? outputs[0]
      : outputs.find((d) => d.deviceId !== 'default') ?? outputs[0]

    if (target) void el.setSinkId(target.deviceId).catch(() => {})
  }, [speaker, outputs, remoteStream])

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

            {/*
              Rendered from the moment the panel opens, not only once the call
              is active. The element has to exist before `srcObject` is set,
              and binding it later is why the camera came on with a blank
              preview.
            */}
            <div
              className={cn(
                'relative overflow-hidden rounded-xl bg-black',
                !withVideo && 'hidden'
              )}
            >
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="aspect-video w-full object-cover"
              >
                <track kind="captions" />
              </video>

              {/* `muted` on your own preview, or you hear yourself. */}
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute right-2 bottom-2 w-20 rounded-lg ring-1 ring-white/20"
              >
                <track kind="captions" />
              </video>

              {phase !== 'active' && (
                <span className="absolute inset-x-0 top-2 text-center text-[10px] text-white/70">
                  {phase === 'ringing' ? '等對方接起⋯' : '連線中⋯'}
                </span>
              )}
            </div>

            {!withVideo && (
              <video ref={remoteVideoRef} autoPlay playsInline className="hidden">
                <track kind="captions" />
              </video>
            )}

            {/* ---- volume ------------------------------------------------ */}
            {phase !== 'incoming' && (
              <div className="flex items-center gap-2">
                <Volume2 aria-hidden className="size-3.5 shrink-0 text-ink-500" />
                <label className="sr-only" htmlFor="call-volume">
                  通話音量
                </label>
                <input
                  id="call-volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-stage-700 accent-accent-500"
                />
                <span className="w-8 shrink-0 text-right text-[10px] text-ink-600 tabular-nums">
                  {Math.round(volume * 100)}%
                </span>
              </div>
            )}

            {problem && (
              <p role="alert" className="text-[10px] leading-relaxed text-amber-300">
                {problem}
              </p>
            )}

            {/*
              Shown while connecting and after a failure, hidden once the call
              is up. Ugly on purpose: it is a diagnostic, and it is readable
              aloud over the very call that is failing.
            */}
            {trace && phase !== 'active' && phase !== 'incoming' && (
              <p className="font-mono text-[9px] leading-relaxed break-all text-ink-600">
                {trace}
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

                  {/*
                    Only when the browser can actually switch output and there
                    is more than one to switch to — a button that silently
                    does nothing is worse than no button.
                  */}
                  {outputs.length > 1 && 'setSinkId' in HTMLMediaElement.prototype && (
                    <CallButton
                      label={speaker ? '關閉擴音' : '擴音'}
                      active={speaker}
                      onClick={() => setSpeaker((on) => !on)}
                    >
                      {speaker ? (
                        <Volume2 aria-hidden className="size-4" />
                      ) : (
                        <Volume1 aria-hidden className="size-4" />
                      )}
                    </CallButton>
                  )}

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
