/**
 * Is there enough in a project for the AI to work from?
 *
 * No database imports — the page passes the counts in, so the dialog can warn
 * before anything is spent.
 *
 * This exists because of a real session: a 5-episode outline request ran for
 * 19 seconds and came back refusing to write, listing exactly what was
 * missing. The model was right and the system prompt told it to behave that
 * way. What was wrong was finding out *afterwards*, having paid for it.
 */

export type ProjectReadiness = {
  characters: number
  charactersWithDetail: number
  worldEntries: number
  episodesWithOutline: number
  hasSynopsis: boolean
}

export type ReadinessWarning = {
  severity: 'blocking' | 'thin'
  missing: string[]
  message: string
}

/**
 * What is missing, in the order the model complains about it.
 *
 * `blocking` means a refusal is the likely outcome, not a certainty — the
 * dialog still lets the run proceed. Refusing to even try would be a worse
 * failure than the one it is warning about.
 */
export function checkReadiness(input: ProjectReadiness): ReadinessWarning | null {
  const missing: string[] = []

  if (!input.hasSynopsis) missing.push('作品大綱（故事在講什麼）')
  if (input.worldEntries === 0) missing.push('世界觀設定（時代、舞台）')
  if (input.characters === 0) missing.push('角色')
  else if (input.charactersWithDetail === 0) {
    missing.push('角色的性格或背景（目前只有名字）')
  }

  if (missing.length === 0) {
    /*
     * Everything is defined but nothing has been outlined yet. Not a problem
     * for the first batch — there is simply nothing to continue from — so this
     * is worth saying once rather than treating as an error.
     */
    if (input.episodesWithOutline === 0) {
      return {
        severity: 'thin',
        missing: [],
        message:
          '還沒有任何一集寫過大綱，所以 AI 沒有前情可以承接。第一批建議從第 1 集開始，' +
          '寫完幾集之後再往後生成會接得比較順。',
      }
    }
    return null
  }

  return {
    severity: missing.length >= 2 ? 'blocking' : 'thin',
    missing,
    message:
      missing.length >= 2
        ? `這個作品目前缺少：${missing.join('、')}。` +
          'AI 很可能會回覆「資訊不足」而不是寫出大綱——系統提示要求它不得憑空編造設定。' +
          '先把這些補上，產出的品質差很多。'
        : `這個作品還缺少：${missing.join('、')}。補上之後產出的品質會明顯不同。`,
  }
}
