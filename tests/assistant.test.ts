import { describe, expect, it } from 'vitest'
import {
  COMMAND_GROUPS,
  SLASH_COMMANDS,
  matchingCommands,
  readThreadMessage,
} from '@/lib/assistant/triggers'

/**
 * 在助理自己的對話串裡，一句話是什麼意思（Z100）。
 *
 * 助理原本住在兩個人的對話裡，要用 @助理 叫醒，所以這組測試原本在測
 * 「什麼會叫醒它」。搬出來之後那個問題不存在了——這條對話串裡打的每一句
 * 都是對它說的——剩下的問題是：哪些句子要花錢，哪些不用。
 *
 * 打錯的指令是重點。`/outlinee 第四集` 如果被當成一般句子送出去，使用者
 * 要花一輪模型費用才知道自己打錯字。
 */
describe('readThreadMessage', () => {
  it('一般句子就是對助理的要求，不用加任何符號', () => {
    expect(readThreadMessage('第三集在講什麼')).toEqual({
      kind: 'mention',
      prompt: '第三集在講什麼',
    })
  })

  it('句子中間或開頭提到 @助理 也只是句子，不用再特別處理', () => {
    // 搬出來之後 @ 沒有特殊意義了，這裡不該再有「開頭才算」那種規則。
    expect(readThreadMessage('@助理 在嗎')).toEqual({ kind: 'mention', prompt: '@助理 在嗎' })
  })

  it('空白不算一句話', () => {
    expect(readThreadMessage('')).toEqual({ kind: 'empty' })
    expect(readThreadMessage('   \n ')).toEqual({ kind: 'empty' })
  })

  it('認得的斜線指令會帶出指令名與參數', () => {
    expect(readThreadMessage('/polish 第二集開頭改緊一點')).toEqual({
      kind: 'command',
      command: 'polish',
      prompt: '第二集開頭改緊一點',
    })
  })

  it('/help 不需要參數', () => {
    expect(readThreadMessage('/help')).toEqual({ kind: 'command', command: 'help', prompt: '' })
  })

  it('指令大小寫不敏感', () => {
    expect(readThreadMessage('/POLISH 改一下')).toEqual({
      kind: 'command',
      command: 'polish',
      prompt: '改一下',
    })
  })

  it('舊的 /rewrite 已經不存在，不會被默默當成別的指令', () => {
    // 它拆成 /write（可以動情節）跟 /polish（只能動文字）。
    // 繼續接受 /rewrite 會讓人以為自己限制住了它，其實沒有。
    expect(readThreadMessage('/rewrite 改一下').kind).toBe('unknown-command')
  })

  it('打錯的指令會被認出來，不會送去模型', () => {
    // 關鍵是 kind 不是 mention：打錯字不該花一輪的錢才知道。
    expect(readThreadMessage('/outlinee 第四集')).toEqual({
      kind: 'unknown-command',
      typed: '/outlinee',
    })
    expect(readThreadMessage('/nonsense 做點什麼').kind).toBe('unknown-command')
  })

  it('路徑跟日期不會被誤判成指令', () => {
    expect(readThreadMessage('/Users/luffy/Desktop').kind).toBe('unknown-command')
    // 日期不是開頭的斜線，所以就是一般句子。
    expect(readThreadMessage('11/4 要交片')).toEqual({ kind: 'mention', prompt: '11/4 要交片' })
  })

  it('只打一個斜線不算指令', () => {
    expect(readThreadMessage('/').kind).toBe('unknown-command')
  })
})

describe('matchingCommands', () => {
  it('不是斜線開頭就不顯示選單', () => {
    expect(matchingCommands('第三集')).toEqual([])
    expect(matchingCommands('')).toEqual([])
  })

  it('只打斜線會列出全部', () => {
    expect(matchingCommands('/').length).toBeGreaterThan(3)
  })

  it('打一部分會縮小範圍', () => {
    expect(matchingCommands('/po').map((command) => command.name)).toEqual(['polish'])
    expect(matchingCommands('/ch').map((command) => command.name)).toEqual([
      'check',
      'character',
    ])
  })

  it('已經開始打參數就不再過濾指令本身', () => {
    const names = matchingCommands('/outline 第四集').map((command) => command.name)
    expect(names).toEqual(['outline'])
  })
})

describe('SLASH_COMMANDS', () => {
  it('每個指令都有說明面板需要的欄位', () => {
    // 右上角的問號跟 /help 都是從這個陣列長出來的，少一個欄位就是空白。
    for (const command of SLASH_COMMANDS) {
      expect(command.label, command.name).toBe(`/${command.name}`)
      expect(command.usage.startsWith(command.label), command.name).toBe(true)
      expect(command.hint.length, command.name).toBeGreaterThan(0)
      expect(command.detail.length, command.name).toBeGreaterThan(10)
      expect(command.example.startsWith(command.label), command.name).toBe(true)
    }
  })

  it('每個指令的範例自己送出去都是合法的', () => {
    for (const command of SLASH_COMMANDS) {
      const intent = readThreadMessage(command.example)
      expect(intent.kind, command.name).toBe('command')
      if (intent.kind !== 'command') continue
      expect(intent.command, command.name).toBe(command.name)
      // 需要參數的指令，範例就得真的帶參數。
      expect(intent.prompt.length > 0, command.name).toBe(command.needsArgument)
    }
  })

  it('每個指令都屬於一個列得出來的分組', () => {
    const keys = COMMAND_GROUPS.map((group) => group.key)
    for (const command of SLASH_COMMANDS) {
      expect(keys, command.name).toContain(command.group)
    }
  })

  it('沒有重複的指令名', () => {
    const names = SLASH_COMMANDS.map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
