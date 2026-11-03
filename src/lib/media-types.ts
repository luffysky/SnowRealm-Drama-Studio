/**
 * What kind of media a file actually is.
 *
 * The browser's `File.type` cannot be trusted for media. It comes from the
 * operating system's registry, so on Windows a `.mkv`, `.flac` or `.avi` very
 * often arrives as `application/octet-stream` — or as an empty string — purely
 * because no application claimed the extension. Rejecting those would mean a
 * perfectly ordinary video file "not being supported", with nothing on screen
 * to explain why.
 *
 * So the extension is used as a fallback. It is not authoritative either, but
 * between the two there is almost always one usable answer, and the file is
 * stored and served by key regardless.
 *
 * No database imports: the uploader validates in the browser before spending
 * bandwidth, and the server validates again before signing anything.
 */

export type MediaFamily = 'image' | 'video' | 'audio' | 'document' | 'unknown'

/**
 * Extension → MIME. Deliberately broad.
 *
 * Animated formats sit with the stills they share a container with: an
 * animated GIF or WebP is still an image to every decoder that matters, and
 * splitting them would mean a sticker stops uploading the day someone animates
 * it.
 */
const BY_EXTENSION: Record<string, string> = {
  // --- 圖片（含動圖）------------------------------------------------------
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
  psd: 'image/vnd.adobe.photoshop',

  // --- 影片 ---------------------------------------------------------------
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  mxf: 'application/mxf',
  prores: 'video/quicktime',

  // --- 音訊 ---------------------------------------------------------------
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  aifc: 'audio/aiff',
  alac: 'audio/mp4',
  amr: 'audio/amr',
  mid: 'audio/midi',
  midi: 'audio/midi',

  // --- 文件 ---------------------------------------------------------------
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  srt: 'text/plain',
  vtt: 'text/vtt',
  ass: 'text/plain',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** Types the browser reports when it simply does not know. */
const USELESS = new Set(['', 'application/octet-stream', 'application/unknown', 'binary/octet-stream'])

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim())
  return match ? match[1]!.toLowerCase() : ''
}

/**
 * The best available MIME type for a file.
 *
 * Prefers what the browser said, unless that is one of the "I have no idea"
 * answers — in which case the extension decides. Returns an empty string when
 * neither knows, which callers treat as "store it, do not guess".
 */
export function resolveMimeType(filename: string, reported: string): string {
  const type = reported.trim().toLowerCase()
  if (type && !USELESS.has(type)) return type

  return BY_EXTENSION[extensionOf(filename)] ?? ''
}

export function familyOf(mimeType: string): MediaFamily {
  const type = mimeType.toLowerCase()

  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (
    type.startsWith('text/') ||
    type === 'application/pdf' ||
    type === 'application/json' ||
    type === 'application/zip' ||
    type.startsWith('application/vnd.')
  ) {
    return 'document'
  }
  // MXF is a video container that does not live under `video/`.
  if (type === 'application/mxf') return 'video'

  return 'unknown'
}

/**
 * `accept` for a file input, for one family.
 *
 * Both the wildcard *and* the extensions: the wildcard alone hides files whose
 * type the OS does not know — which is the same `.mkv` and `.flac` problem,
 * showing up as "the file picker greys out my video" instead of as an error.
 */
export function acceptFor(family: 'image' | 'video' | 'audio'): string {
  const extensions = Object.entries(BY_EXTENSION)
    .filter(([, mime]) => familyOf(mime) === family)
    .map(([extension]) => `.${extension}`)

  return [`${family}/*`, ...extensions].join(',')
}

/** Every media extension, for an input that takes anything. */
export function acceptAnyMedia(): string {
  return ['image/*', 'video/*', 'audio/*', ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)].join(
    ','
  )
}
