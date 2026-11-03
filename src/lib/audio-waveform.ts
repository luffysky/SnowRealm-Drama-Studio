'use client'

/**
 * Waveform peaks, computed in the browser (design 83).
 *
 * Stored as a `WAVEFORM` variant beside the audio file so the player does not
 * have to download and decode the whole track to draw anything. A three-minute
 * MP3 is several megabytes; its peaks are a few kilobytes.
 *
 * The spec is explicit that a failure must degrade to the native player rather
 * than draw something plausible: **a fake waveform is worse than no waveform**,
 * because it invites someone to scrub to a peak that is not there.
 */

/**
 * How many peaks to store.
 *
 * One per horizontal pixel at a generous width. More is wasted — the canvas
 * cannot show detail it has no pixels for — and fewer makes a long track look
 * like a rectangle.
 */
const PEAK_COUNT = 1600

export type WaveformData = {
  /** `PEAK_COUNT` values in 0..1, the normalised maximum of each slice. */
  peaks: number[]
  durationSec: number
  sampleRate: number
  channels: number
  version: 1
}

/**
 * Decodes an audio file and reduces it to peaks.
 *
 * Returns null rather than throwing on any failure — an unsupported codec, a
 * corrupt file, a browser without Web Audio. The caller treats that as "no
 * waveform", which is a supported state.
 */
export async function computeWaveform(file: Blob): Promise<WaveformData | null> {
  if (typeof window === 'undefined') return null

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null

  let context: AudioContext | null = null

  try {
    const bytes = await file.arrayBuffer()

    /*
     * An OfflineAudioContext would need the sample rate and length up front,
     * which is exactly what we are trying to find out. A regular context is
     * closed immediately after decoding.
     */
    context = new AudioContextCtor()
    const buffer = await context.decodeAudioData(bytes)

    const peaks = reduceToPeaks(buffer, PEAK_COUNT)

    return {
      peaks,
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      version: 1,
    }
  } catch {
    return null
  } finally {
    void context?.close().catch(() => {})
  }
}

/**
 * Maximum absolute amplitude per slice, across all channels.
 *
 * Peak rather than RMS: a waveform is read to find where something *happens*,
 * and RMS flattens exactly the transients — a door slam, a line starting —
 * that someone is scrubbing to find.
 */
function reduceToPeaks(buffer: AudioBuffer, count: number): number[] {
  const peaks = new Array<number>(count).fill(0)
  const sliceLength = Math.max(1, Math.floor(buffer.length / count))

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)

    for (let slice = 0; slice < count; slice += 1) {
      const start = slice * sliceLength
      const end = Math.min(start + sliceLength, data.length)

      let peak = 0
      for (let i = start; i < end; i += 1) {
        const value = Math.abs(data[i] ?? 0)
        if (value > peak) peak = value
      }

      if (peak > peaks[slice]!) peaks[slice] = peak
    }
  }

  // Normalise, so a quietly recorded take still fills the canvas. A silent
  // file stays all zeros rather than being divided by zero into NaN.
  const loudest = peaks.reduce((max, value) => (value > max ? value : max), 0)
  if (loudest <= 0) return peaks

  return peaks.map((value) => Number((value / loudest).toFixed(4)))
}

/* -------------------------------------------------------------------------- */

/**
 * A poster frame for a video, taken in the browser.
 *
 * Same purpose as the image preview: a grid of episode cards should not pull
 * down a hundred megabytes of video to show a thumbnail.
 */
export async function captureVideoPoster(file: Blob): Promise<Blob | null> {
  if (typeof window === 'undefined') return null

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')

  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('video decode failed'))
      // A file the browser cannot decode would otherwise hang the upload's
      // follow-up work forever.
      setTimeout(() => reject(new Error('video decode timed out')), 15_000)
    })

    /*
     * One second in, not frame zero: a great many videos open on black, and a
     * black thumbnail is indistinguishable from a broken one.
     */
    await seek(video, Math.min(1, (video.duration || 1) / 2))

    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))

    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.8)
    })
  } catch {
    return null
  } finally {
    video.src = ''
    URL.revokeObjectURL(url)
  }
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    video.onseeked = done
    // Seeking past the end, or on a stream with no keyframe there, simply
    // never fires `seeked`; draw whatever frame is loaded instead.
    setTimeout(done, 3000)
    video.currentTime = time
  })
}
