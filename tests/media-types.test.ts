import { describe, expect, it } from 'vitest'
import { acceptAnyMedia, acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'

/**
 * 媒體格式辨識.
 *
 * `File.type` comes from the operating system's registry, so on Windows a
 * perfectly ordinary `.mkv`, `.flac` or `.avi` commonly arrives as
 * `application/octet-stream` — or as an empty string — purely because no
 * application claimed the extension. Before this, those were refused as
 * 「不支援的檔案類型」, which is both wrong and unexplainable to the person
 * holding a video that plays fine everywhere else.
 */

describe('resolveMimeType', () => {
  it('trusts a usable type from the browser', () => {
    expect(resolveMimeType('a.mp4', 'video/mp4')).toBe('video/mp4')
    expect(resolveMimeType('a.mp3', 'audio/mpeg')).toBe('audio/mpeg')
  })

  it('falls back to the extension when the browser says octet-stream', () => {
    // The exact case that made .mkv and .flac unuploadable.
    expect(resolveMimeType('ep001.mkv', 'application/octet-stream')).toBe('video/x-matroska')
    expect(resolveMimeType('theme.flac', 'application/octet-stream')).toBe('audio/flac')
    expect(resolveMimeType('old.avi', 'application/octet-stream')).toBe('video/x-msvideo')
  })

  it('falls back when the browser says nothing at all', () => {
    expect(resolveMimeType('take.wav', '')).toBe('audio/wav')
    expect(resolveMimeType('clip.mov', '')).toBe('video/quicktime')
  })

  it('handles uppercase extensions', () => {
    expect(resolveMimeType('SCENE.PNG', '')).toBe('image/png')
    expect(resolveMimeType('TAKE.WAV', 'APPLICATION/OCTET-STREAM')).toBe('audio/wav')
  })

  it('returns empty when neither source knows', () => {
    // Stored as octet-stream rather than guessed at.
    expect(resolveMimeType('mystery.qqq', '')).toBe('')
  })
})

describe('familyOf', () => {
  it('classifies the formats the studio actually uses', () => {
    expect(familyOf('video/x-msvideo')).toBe('video')
    expect(familyOf('video/x-matroska')).toBe('video')
    expect(familyOf('audio/flac')).toBe('audio')
    expect(familyOf('audio/x-ms-wma')).toBe('audio')
    expect(familyOf('image/avif')).toBe('image')
    expect(familyOf('application/pdf')).toBe('document')
  })

  it('treats animated formats as images', () => {
    /*
     * An animated GIF or WebP is still an image to every decoder that matters.
     * Splitting them off would mean a sticker stops uploading the day someone
     * animates it.
     */
    expect(familyOf(resolveMimeType('wave.gif', ''))).toBe('image')
    expect(familyOf(resolveMimeType('loop.webp', ''))).toBe('image')
    expect(familyOf(resolveMimeType('blink.apng', ''))).toBe('image')
  })

  it('puts MXF with video even though its MIME is not video/', () => {
    expect(familyOf('application/mxf')).toBe('video')
  })
})

describe('accept attributes', () => {
  it('lists extensions as well as the wildcard', () => {
    /*
     * The wildcard alone greys out files whose type the OS does not know —
     * the same .mkv problem, showing up in the file picker instead of as an
     * error message.
     */
    const video = acceptFor('video')

    expect(video).toContain('video/*')
    expect(video).toContain('.mkv')
    expect(video).toContain('.avi')
  })

  it('covers every family for a general picker', () => {
    const any = acceptAnyMedia()

    for (const token of ['image/*', 'video/*', 'audio/*', '.gif', '.wav', '.mp4']) {
      expect(any).toContain(token)
    }
  })
})
