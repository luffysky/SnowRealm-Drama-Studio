import { describe, expect, it } from 'vitest'
import { adapterErrorToApi } from '@/lib/ai/vip'
import { ApiError } from '@/lib/api-error'
import { AiAdapterError } from '@/lib/ai/types'

/**
 * VIP 通道的錯誤要說得出話（Z201）。
 *
 * 排佇列那條路上，失敗會留在 `ai_jobs` 上、顯示在 AI 製片中心。**VIP 通道沒有
 * 那張工作列**，所以不翻譯的話它會從 `handle()` 掉出去變成一個通用的 500——而
 * 供應商實際說的是「你的額度不夠了」。
 *
 * 第二句話是一分鐘能解決的事，第一句話是一個下午。
 */
const CREDIT = 'Your credit balance is too low to access the Anthropic API.'

describe('VIP 通道的錯誤翻譯（Z201）', () => {
  it('額度用完這種有明確動作的，加一句中文——而原話也要在', () => {
    const out = adapterErrorToApi(new AiAdapterError(CREDIT, 'bad_request', false))
    expect(out).toBeInstanceOf(ApiError)
    expect((out as ApiError).status).toBe(502)
    expect(out.message).toContain('額度用完了')
    // 原話是真的要查的時候拿去搜尋的那一個，不可以被翻譯吃掉。
    expect(out.message).toContain('credit balance')
  })

  it('認不得的錯誤原樣帶出去，不要硬掰一句中文', () => {
    const out = adapterErrorToApi(new AiAdapterError('something odd', 'bad_request', false))
    expect(out.message).toContain('something odd')
    expect(out.message).toContain('AI 供應商拒絕了這次請求')
  })

  it('金鑰失效與限流各有自己的那一句', () => {
    expect(
      adapterErrorToApi(new AiAdapterError('invalid x-api-key', 'auth', false)).message
    ).toContain('金鑰')
    expect(
      adapterErrorToApi(new AiAdapterError('rate limit exceeded', 'rate_limited', true)).message
    ).toContain('限流')
  })

  it('可以重試的用 503，分得出「再試一次可能會過」', () => {
    const out = adapterErrorToApi(new AiAdapterError('rate limited', 'rate_limited', true))
    expect((out as ApiError).status).toBe(503)
  })

  it('訊息會截短——供應商偶爾把整個請求回放一遍，那裡面有正文', () => {
    const huge = `${'正'.repeat(5000)}`
    const out = adapterErrorToApi(new AiAdapterError(huge, 'bad_request', false))
    expect(out.message.length).toBeLessThan(260)
  })

  it('不是適配器的錯誤就原樣丟回去，不要裝成供應商的問題', () => {
    const boom = new Error('資料庫連不上')
    expect(adapterErrorToApi(boom)).toBe(boom)
  })
})
