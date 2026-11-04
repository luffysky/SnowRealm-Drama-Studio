'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LyricsEditor } from '@/components/studio/LyricsEditor'
import { LyricsPanel } from '@/components/studio/LyricsPanel'
import { usePlayer } from '@/components/studio/PlayerProvider'
import { apiFetch } from '@/lib/client-fetch'

/**
 * 目前這一首的歌詞 (Z125).
 *
 * Fetches per track rather than taking the whole library's lyrics with the
 * page: the queue is every finished track in the studio, and shipping every
 * sheet to render one would grow that payload for nothing. It also means the
 * editor opens on what is in the database now, which matters when two people
 * are on the same track.
 *
 * Deliberately keeps showing the previous sheet while the next one loads
 * rather than blanking: skipping tracks would otherwise flash the panel empty
 * every time, which reads as 「這首沒有歌詞」 for a moment on every single
 * track that has them.
 */
export function TrackLyrics({ canEdit }: { canEdit: boolean }) {
  const player = usePlayer()
  const track = player.track

  const [lyrics, setLyrics] = useState('')
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  /*
   * Derived, not stored. 「正在讀」 is exactly 「讀到的還不是這一首」, and a
   * `loading` state set inside the effect is both a second render for a value
   * already known and the thing `react-hooks/set-state-in-effect` forbids.
   */
  const loading = Boolean(track) && loadedFor !== track?.assetId

  useEffect(() => {
    if (!track) return
    const assetId = track.assetId
    if (loadedFor === assetId) return

    let cancelled = false

    void (async () => {
      try {
        const response = await apiFetch(
          `/api/projects/${track.projectId}/assets/music/${assetId}/lyrics`
        )
        if (cancelled) return

        if (!response.ok) {
          // A track whose lyrics cannot be read is a track with no lyrics
          // panel, not an error page. Nothing here is worth interrupting
          // listening over.
          setLyrics('')
        } else {
          const body = (await response.json()) as { lyrics?: string }
          setLyrics(body.lyrics ?? '')
        }
        setLoadedFor(assetId)
      } catch {
        if (!cancelled) {
          setLyrics('')
          setLoadedFor(assetId)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [track, loadedFor])

  if (!track) return null

  return (
    <section className="flex min-h-0 flex-col gap-2">
      {loading && (
        <p className="flex items-center gap-1.5 text-[10px] text-ink-600">
          <Loader2 aria-hidden className="size-3 animate-spin" />
          讀取歌詞…
        </p>
      )}

      <LyricsPanel
        assetId={track.assetId}
        lyrics={loadedFor === track.assetId ? lyrics : ''}
        canEdit={canEdit}
        onEdit={() => setEditing(true)}
      />

      {editing && (
        <LyricsEditor
          projectId={track.projectId}
          assetId={track.assetId}
          initial={lyrics}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setLyrics(next)
            setLoadedFor(track.assetId)
          }}
        />
      )}
    </section>
  )
}
