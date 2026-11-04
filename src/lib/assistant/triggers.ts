/**
 * 怎麼跟助理說話 (Z100).
 *
 * The assistant has its own page now, so there is no trigger to detect any
 * more. It used to live in the two-person thread and had to be summoned with
 * `@助理` or a slash command, because a model reading every line of a private
 * conversation is both expensive and rude. Inside its own thread the opposite
 * is true: everything typed there was typed at it, and a handle would just be
 * a word to type a hundred times a day.
 *
 * What survives is the commands, which were never about waking it up — they
 * name a mode of working that a sentence cannot: a scope, or a promise not to
 * change anything.
 *
 * No database imports: the composer uses this to render the picker.
 */

export type CommandGroup = 'read' | 'propose' | 'meta'

export type SlashCommand = {
  name: string
  /** What to show in the picker. */
  label: string
  /** The shape of the argument, for the help panel. */
  usage: string
  hint: string
  /** The longer line in the help panel: what it actually does. */
  detail: string
  /** Something real enough to send as-is. */
  example: string
  group: CommandGroup
  /** Whether it needs text after the command. */
  needsArgument: boolean
}

/**
 * The commands.
 *
 * Each one has to mean something a sentence cannot say. There were six, and
 * two of them were wrong:
 *
 *  - `/rewrite` conflated 「改情節」 with 「改文字」. Those need opposite
 *    instructions — one may change what happens, the other must not — and a
 *    single command meant guessing which was meant every time.
 *  - there was no way to ask it to *check* anything. The one job a model is
 *    reliably good at over 120 episodes is noticing that chapter 40
 *    contradicts chapter 9, and the only way to ask was a sentence that often
 *    came back as a proposal nobody wanted.
 *
 * Grouped by the thing that matters before you press send: whether this spends
 * a turn only reading, or comes back with something to decide.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  /* ---- 只讀 -------------------------------------------------------------- */
  {
    name: 'ask',
    label: '/ask',
    usage: '/ask 問題',
    hint: '問一件事，不改任何東西',
    detail: '查了資料再回答，而且明確不准它提案修改。問設定、問進度、問「這樣寫會不會跟前面打架」用這個。',
    example: '/ask 沈知味到第三集為止知道銅牌的事了嗎',
    group: 'read',
    needsArgument: true,
  },
  {
    name: 'find',
    label: '/find',
    usage: '/find 關鍵字',
    hint: '在作品裡找東西',
    detail: '翻過小說正文、角色設定、世界觀跟分集大綱，告訴你出現在哪幾集哪一段。比自己一集一集開快。',
    example: '/find 銅牌會變冷',
    group: 'read',
    needsArgument: true,
  },
  {
    name: 'recap',
    label: '/recap',
    usage: '/recap 集數或範圍',
    hint: '回顧某幾集在講什麼',
    detail: '把那幾集濃縮成重點：發生什麼、誰知道了什麼、留了什麼伏筆。隔一段時間回來接著寫的時候用。',
    example: '/recap 第一到第三集',
    group: 'read',
    needsArgument: true,
  },
  {
    name: 'check',
    label: '/check',
    usage: '/check 範圍',
    hint: '挑矛盾：設定、時間線、伏筆',
    detail: '只報告不提案。找角色設定前後不一致、時間對不上、伏筆開了沒收。這是它在 120 集這種長度上最派得上用場的地方。',
    example: '/check 第一到第三集的時間線',
    group: 'read',
    needsArgument: true,
  },

  /* ---- 會提案 ------------------------------------------------------------ */
  {
    name: 'write',
    label: '/write',
    usage: '/write 集數 + 要寫什麼',
    hint: '寫或續寫正文',
    detail: '可以動情節。會先讀這部作品現有的設定跟前後集，再提案。原文一個字都不會被直接蓋掉。',
    example: '/write 第四集 從沈知味被叫去碼頭開始寫',
    group: 'propose',
    needsArgument: true,
  },
  {
    name: 'polish',
    label: '/polish',
    usage: '/polish 範圍 + 想怎麼改',
    hint: '潤稿，不動情節',
    detail: '只改文字——節奏、重複的詞、鬆掉的句子。明確禁止它改任何劇情、對話內容或設定，所以 diff 應該只有措辭在動。',
    example: '/polish 第二集開頭 太鬆，收緊一點',
    group: 'propose',
    needsArgument: true,
  },
  {
    name: 'outline',
    label: '/outline',
    usage: '/outline 集數 + 需求',
    hint: '寫或改分集大綱',
    detail: '寫那一集的大綱／一句話／集名。會先看前後幾集，免得寫出一個接不上的大綱。',
    example: '/outline 第四集 接著第三集往下走',
    group: 'propose',
    needsArgument: true,
  },
  {
    name: 'character',
    label: '/character',
    usage: '/character 角色 + 需求',
    hint: '補角色設定',
    detail: '性格、背景、外觀、成長弧線、定妝提示詞。會先讀正文裡這個角色實際做過什麼，而不是憑空想一個人。',
    example: '/character 許山河 補背景，要跟第三集那場戲對得上',
    group: 'propose',
    needsArgument: true,
  },
  {
    name: 'world',
    label: '/world',
    usage: '/world 條目 + 需求',
    hint: '補世界觀條目',
    detail: '地點、規矩、器物、組織這些。同樣是提案，而且只用正文裡真的寫過的東西。',
    example: '/world 碼頭 把規矩寫清楚一點',
    group: 'propose',
    needsArgument: true,
  },

  /* ---- 其他 -------------------------------------------------------------- */
  {
    name: 'help',
    label: '/help',
    usage: '/help',
    hint: '指令說明',
    detail: '把這份說明貼進對話裡。右上角的問號是同一份。',
    example: '/help',
    group: 'meta',
    needsArgument: false,
  },
]

export const COMMAND_GROUPS: { key: CommandGroup; label: string; note: string }[] = [
  { key: 'read', label: '只看，不動任何東西', note: '這些不會產生提案' },
  { key: 'propose', label: '會提案，套不套用你決定', note: '套用之前會先備份原本的' },
  { key: 'meta', label: '其他', note: '' },
]

/** What `runAssistant` is given. */
export type Trigger =
  | { kind: 'mention'; prompt: string }
  | { kind: 'command'; command: string; prompt: string }
  | null

/** What a line typed in an assistant thread turns out to be. */
export type ThreadIntent =
  | { kind: 'mention'; prompt: string }
  | { kind: 'command'; command: string; prompt: string }
  /** `/nope` — answered locally, for free. */
  | { kind: 'unknown-command'; typed: string }
  | { kind: 'empty' }

/**
 * Reads a line from an assistant thread.
 *
 * A mistyped command is its own case rather than being passed through as
 * prose. `/outlinee 第四集` sent as a sentence would spend a model turn on
 * finding out it is not a command, and the person would be charged for a
 * typo; said back locally it costs nothing.
 */
export function readThreadMessage(body: string): ThreadIntent {
  const text = body.trim()
  if (!text) return { kind: 'empty' }

  if (text.startsWith('/')) {
    const match = /^\/([a-zA-Z]+)\s*([\s\S]*)$/.exec(text)
    if (!match) return { kind: 'unknown-command', typed: text.split(/\s/)[0] ?? text }

    const name = (match[1] ?? '').toLowerCase()
    const known = SLASH_COMMANDS.find((command) => command.name === name)
    if (!known) return { kind: 'unknown-command', typed: `/${match[1] ?? ''}` }

    return { kind: 'command', command: name, prompt: (match[2] ?? '').trim() }
  }

  return { kind: 'mention', prompt: text }
}

/** The command names, for the composer's picker filter. */
export function matchingCommands(draft: string): SlashCommand[] {
  if (!draft.startsWith('/')) return []
  const typed = (draft.split(/\s/)[0] ?? '/').toLowerCase()
  return SLASH_COMMANDS.filter((command) => command.label.startsWith(typed))
}
