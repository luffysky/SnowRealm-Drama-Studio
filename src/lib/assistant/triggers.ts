/**
 * 什麼時候叫得動助理 (Z100).
 *
 * **Nothing else wakes it.** Not a plain message, not a mention of AI in
 * passing, not a question addressed to the other person. It reads only what
 * is handed to it explicitly, which is what makes it affordable — a studio
 * writing all day would otherwise send every line of a private conversation
 * to a model — and what keeps it from talking over two people who are
 * talking to each other.
 *
 * No database imports: the composer uses this to decide whether to show the
 * 「助理正在想」 indicator before the round trip.
 */

/** The handles that summon it. Matched at the start of a message only. */
export const ASSISTANT_HANDLES = ['@助理', '@AI', '@ai', '@Ai'] as const

export type SlashCommand = {
  name: string
  /** What to show in the picker. */
  label: string
  hint: string
  /** Whether it needs text after the command. */
  needsArgument: boolean
}

/**
 * The slash commands.
 *
 * Deliberately few. A command is worth having when it means something the
 * assistant cannot infer from a sentence — a scope, or a mode of working.
 * Anything that is just a phrasing of a request belongs in the request.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'ask',
    label: '/ask',
    hint: '問一件事，不改任何東西',
    needsArgument: true,
  },
  {
    name: 'rewrite',
    label: '/rewrite',
    hint: '改寫目前開著的章節，會給你看 diff 再決定',
    needsArgument: true,
  },
  {
    name: 'outline',
    label: '/outline',
    hint: '幫某一集寫或改大綱',
    needsArgument: true,
  },
  {
    name: 'character',
    label: '/character',
    hint: '補角色設定',
    needsArgument: true,
  },
  {
    name: 'find',
    label: '/find',
    hint: '在這部作品裡找東西',
    needsArgument: true,
  },
  {
    name: 'help',
    label: '/help',
    hint: '這個助理會什麼',
    needsArgument: false,
  },
]

export type Trigger =
  | { kind: 'mention'; prompt: string }
  | { kind: 'command'; command: string; prompt: string }
  | null

/**
 * Reads a message and decides whether the assistant was addressed.
 *
 * Start-anchored on purpose. 「我跟 @助理 說過了」 is a sentence about the
 * assistant, not a request to it, and a model woken by every mention of its
 * own name is a model that interrupts.
 */
export function detectTrigger(body: string): Trigger {
  const text = body.trim()
  if (!text) return null

  for (const handle of ASSISTANT_HANDLES) {
    if (text.startsWith(handle)) {
      return { kind: 'mention', prompt: text.slice(handle.length).trim() }
    }
  }

  if (text.startsWith('/')) {
    const match = /^\/([a-zA-Z]+)\s*([\s\S]*)$/.exec(text)
    if (!match) return null

    const name = (match[1] ?? '').toLowerCase()
    const known = SLASH_COMMANDS.find((command) => command.name === name)

    /*
     * An unknown command is not a trigger. Someone typing a path, or a date
     * like 11/4, should not spend money finding out the assistant does not
     * understand it.
     */
    if (!known) return null

    return { kind: 'command', command: name, prompt: (match[2] ?? '').trim() }
  }

  return null
}

/** Whether this message will wake the assistant. For the composer's hint. */
export function willTrigger(body: string): boolean {
  return detectTrigger(body) !== null
}
