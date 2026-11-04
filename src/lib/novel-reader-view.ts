/**
 * Reader preferences, with no database imports.
 *
 * These are per-viewer conveniences and live in `localStorage`: a font size is
 * a property of the person and the screen in front of them, not of the book,
 * and syncing it to the server would make one member's phone change the
 * other's desk.
 */

export const READING_MODES = ['scroll', 'horizontal', 'flip'] as const
export type ReadingMode = (typeof READING_MODES)[number]

export const READING_MODE_LABEL: Record<ReadingMode, string> = {
  scroll: '上下捲動',
  horizontal: '左右翻頁',
  flip: '模擬翻書',
}

export const READING_MODE_HINT: Record<ReadingMode, string> = {
  scroll: '一直往下讀，跟網頁一樣。',
  horizontal: '左右滑動換頁，不做翻頁動畫。',
  flip: '左右滑動換頁，有書頁翻動的動畫。',
}

export const READER_THEMES = ['paper', 'sepia', 'dark', 'green', 'black'] as const
export type ReaderTheme = (typeof READER_THEMES)[number]

export const READER_THEME_LABEL: Record<ReaderTheme, string> = {
  paper: '紙白',
  sepia: '米黃',
  green: '護眼綠',
  dark: '夜間',
  black: '純黑',
}

/**
 * Background and ink for each theme.
 *
 * `black` is separate from `dark` on purpose: on an OLED screen a true black
 * turns the pixels off, which is a real difference in a dark room and in
 * battery use, and a near-black grey does not do it.
 */
export const READER_THEME_COLORS: Record<ReaderTheme, { bg: string; ink: string; faint: string }> =
  {
    paper: { bg: '#fdfbf7', ink: '#1b1b1f', faint: '#8a8694' },
    sepia: { bg: '#f3e9d6', ink: '#3a2f23', faint: '#8a7a63' },
    green: { bg: '#cde0ce', ink: '#22302a', faint: '#64796a' },
    dark: { bg: '#15131c', ink: '#d9d7e0', faint: '#7b7790' },
    black: { bg: '#000000', ink: '#b9b7c4', faint: '#6a6878' },
  }

export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 32
export const FONT_SIZE_DEFAULT = 19

export const LINE_HEIGHT_MIN = 1.5
export const LINE_HEIGHT_MAX = 2.6
export const LINE_HEIGHT_DEFAULT = 2

/** Screen dimming, applied as an overlay. 1 is untouched. */
export const BRIGHTNESS_MIN = 0.3
export const BRIGHTNESS_MAX = 1
export const BRIGHTNESS_DEFAULT = 1

export const READER_FONTS = ['serif', 'sans'] as const
export type ReaderFont = (typeof READER_FONTS)[number]

export const READER_FONT_LABEL: Record<ReaderFont, string> = {
  serif: '明體',
  sans: '黑體',
}

export const READER_FONT_STACK: Record<ReaderFont, string> = {
  serif:
    '"Noto Serif TC", "Source Han Serif TC", "PingFang TC", "Songti TC", "Microsoft JhengHei", serif',
  sans: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif',
}

export const SPEECH_RATE_MIN = 0.5
export const SPEECH_RATE_MAX = 2
export const SPEECH_RATE_DEFAULT = 1

export const SPEECH_PITCH_MIN = 0.5
export const SPEECH_PITCH_MAX = 1.5
export const SPEECH_PITCH_DEFAULT = 1

export type ReaderSettings = {
  mode: ReadingMode
  theme: ReaderTheme
  font: ReaderFont
  fontSize: number
  lineHeight: number
  brightness: number
  /** 朗讀的音色。空字串＝系統預設。 */
  voiceId: string
  speechRate: number
  speechPitch: number
  /**
   * 分角色朗讀 (Z111)。
   *
   * Off by default. Attribution is guesswork at the edges, and somebody who
   * just wants the chapter read to them should not have to notice that a
   * voice changed for a reason they did not ask about.
   */
  castVoices: boolean
  /**
   * 正文顯示繁體還是簡體 (Z135)。
   *
   * **跟介面的設定分開。** 介面是給操作的人看的，正文是作品本身——有人想用
   * 簡體介面讀繁體原文，也有人反過來。綁在一起就少了那兩種讀法。
   *
   * `original` 是作者寫的字（繁體），所以切回去不需要任何轉換。
   */
  script: 'original' | 'simplified'
}

export const READER_DEFAULTS: ReaderSettings = {
  mode: 'scroll',
  theme: 'paper',
  font: 'serif',
  fontSize: FONT_SIZE_DEFAULT,
  lineHeight: LINE_HEIGHT_DEFAULT,
  brightness: BRIGHTNESS_DEFAULT,
  voiceId: '',
  speechRate: SPEECH_RATE_DEFAULT,
  speechPitch: SPEECH_PITCH_DEFAULT,
  castVoices: false,
  // 預設簡體，跟介面一致——大陸市場是主要讀者。
  script: 'simplified',
}

export const READER_STORAGE_KEY = 'srds.reader.settings.v2'

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min

/**
 * Reads saved settings, surviving anything that might be in there.
 *
 * `localStorage` can throw outright in a private window or with site data
 * blocked, and its contents are whatever an older build of this page wrote. So
 * every field is validated and anything unrecognised falls back to the default
 * rather than being trusted into a style attribute.
 */
export function loadReaderSettings(): ReaderSettings {
  if (typeof window === 'undefined') return READER_DEFAULTS

  try {
    const raw = window.localStorage.getItem(READER_STORAGE_KEY)
    if (!raw) return READER_DEFAULTS

    const parsed = JSON.parse(raw) as Partial<ReaderSettings>

    return {
      mode: READING_MODES.includes(parsed.mode as ReadingMode)
        ? (parsed.mode as ReadingMode)
        : READER_DEFAULTS.mode,
      theme: READER_THEMES.includes(parsed.theme as ReaderTheme)
        ? (parsed.theme as ReaderTheme)
        : READER_DEFAULTS.theme,
      font: READER_FONTS.includes(parsed.font as ReaderFont)
        ? (parsed.font as ReaderFont)
        : READER_DEFAULTS.font,
      fontSize: clamp(Number(parsed.fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX),
      lineHeight: clamp(Number(parsed.lineHeight), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
      brightness: clamp(Number(parsed.brightness), BRIGHTNESS_MIN, BRIGHTNESS_MAX),
      // A voice id from another machine simply will not match any installed
      // voice, and the speech layer falls back to the system default.
      voiceId: typeof parsed.voiceId === 'string' ? parsed.voiceId : '',
      speechRate: clamp(Number(parsed.speechRate), SPEECH_RATE_MIN, SPEECH_RATE_MAX),
      speechPitch: clamp(Number(parsed.speechPitch), SPEECH_PITCH_MIN, SPEECH_PITCH_MAX),
      castVoices: parsed.castVoices === true,
      // Anything unrecognised falls back to the default rather than being
      // trusted — the same rule every other field here follows.
      script: parsed.script === 'original' ? 'original' : READER_DEFAULTS.script,
    }
  } catch {
    return READER_DEFAULTS
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    window.localStorage.setItem(READER_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private window, or site data blocked. The reader still works; it just
    // forgets. Nothing here is worth interrupting someone's reading for.
  }
}
