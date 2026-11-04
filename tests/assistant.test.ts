import { describe, expect, it } from 'vitest'
import { detectTrigger, willTrigger } from '@/lib/assistant/triggers'

/**
 * 什麼會叫醒助理（Z100）。
 *
 * 這組規則決定了兩件事：這個對話有多少內容會被送給模型，以及它會不會
 * 插話。放寬一點點——例如句子中間提到 @助理 也算——就會變成兩個人聊天
 * 的時候它一直插嘴，而且每句都在花錢。
 */
describe('detectTrigger', () => {
  it('@助理 開頭會叫醒它，並且把後面的當成要求', () => {
    expect(detectTrigger('@助理 第三集在講什麼')).toEqual({
      kind: 'mention',
      prompt: '第三集在講什麼',
    })
  })

  it('@AI 大小寫都認得', () => {
    expect(detectTrigger('@AI 幫我看一下')?.kind).toBe('mention')
    expect(detectTrigger('@ai 幫我看一下')?.kind).toBe('mention')
  })

  it('句子中間提到助理不算叫它', () => {
    // 「我跟 @助理 說過了」是在講它，不是在叫它。
    expect(detectTrigger('我剛剛跟 @助理 說過了')).toBeNull()
    expect(detectTrigger('這段可以問 @AI')).toBeNull()
  })

  it('一般訊息完全不會觸發', () => {
    expect(detectTrigger('第三集寫完了')).toBeNull()
    expect(detectTrigger('晚點打給你')).toBeNull()
    expect(detectTrigger('')).toBeNull()
    expect(detectTrigger('   ')).toBeNull()
  })

  it('認得的斜線指令會帶出指令名與參數', () => {
    expect(detectTrigger('/rewrite 開頭改緊一點')).toEqual({
      kind: 'command',
      command: 'rewrite',
      prompt: '開頭改緊一點',
    })
  })

  it('/help 不需要參數', () => {
    expect(detectTrigger('/help')).toEqual({ kind: 'command', command: 'help', prompt: '' })
  })

  it('不認得的斜線不算觸發', () => {
    // 打日期 11/4、貼路徑 /Users/... 都不該花錢去問模型它看不懂。
    expect(detectTrigger('/nonsense 做點什麼')).toBeNull()
    expect(detectTrigger('/Users/luffy/Desktop')).toBeNull()
    expect(detectTrigger('/ 空的')).toBeNull()
  })

  it('日期不會被當成指令', () => {
    expect(detectTrigger('11/4 要交片')).toBeNull()
  })

  it('指令大小寫不敏感', () => {
    expect(detectTrigger('/REWRITE 改一下')?.kind).toBe('command')
  })

  it('willTrigger 跟 detectTrigger 的判斷一致', () => {
    const cases = ['@助理 在嗎', '/find 沈知味', '一般訊息', '/unknown', '']
    for (const text of cases) {
      expect(willTrigger(text)).toBe(detectTrigger(text) !== null)
    }
  })
})
