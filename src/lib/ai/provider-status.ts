import { adapterForTask } from './jobs'
import type { AiTaskKind } from './types'

/**
 * 有沒有一家供應商接得了這個任務，接不了的話是為什麼 (Z153).
 *
 * 這段本來一字不差地抄在小說頁、劇本頁跟作品小說頁裡三份。再多四個發動點
 * 就會變成七份，而**七份會分岔**——分岔之後有的頁面說「尚未設定」、有的頁
 * 面乾脆把按鈕畫成可以按的。
 *
 * 不丟例外：介面要的是「能不能按、不能按的話旁邊寫什麼」，而一個會炸掉整
 * 頁的 helper 回答不了這個問題。
 */
export async function aiProviderStatus(
  task: AiTaskKind
): Promise<{ available: boolean; detail?: string }> {
  try {
    const resolved = await adapterForTask(task, null)
    if (!resolved) return { available: false, detail: '尚未設定任何可用的 AI 供應商。' }

    const status = await resolved.adapter.status()
    return {
      available: status.available,
      ...(status.detail ? { detail: status.detail } : {}),
    }
  } catch (error) {
    return {
      available: false,
      ...(error instanceof Error ? { detail: error.message } : {}),
    }
  }
}
