import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 小說轉劇本為什麼每次都失敗 (Z157).
 *
 * 錯誤訊息說「模型把輸出額度用在思考上」。在改任何數字之前先問資料：實際送
 * 了多少 input、花了多少 output、用的是哪個模型、哪種 effort。
 *
 * 憑印象調 max_tokens 就是在猜，而猜錯的代價是下一次生成又花一次錢。
 */
async function main() {
  const { db } = await import('../src/db')
  const { aiJobs, aiJobAttempts } = await import('../src/db/schema')
  const { desc, eq, inArray } = await import('drizzle-orm')

  const jobs = await db
    .select({
      id: aiJobs.id,
      kind: aiJobs.kind,
      status: aiJobs.status,
      model: aiJobs.model,
      errorMessage: aiJobs.errorMessage,
      request: aiJobs.request,
      estimatedCost: aiJobs.estimatedCost,
      actualCost: aiJobs.actualCost,
      createdAt: aiJobs.createdAt,
    })
    .from(aiJobs)
    .where(inArray(aiJobs.kind, ['NOVEL_TO_SCRIPT', 'STORYBOARD_GENERATE']))
    .orderBy(desc(aiJobs.createdAt))
    .limit(8)

  if (jobs.length === 0) {
    console.log('  沒有任何小說轉劇本的任務紀錄')
    return
  }

  for (const job of jobs) {
    const request = job.request as Record<string, unknown> | null
    const context = (request?.context ?? {}) as Record<string, unknown>
    const sourceText = typeof context.sourceText === 'string' ? context.sourceText : ''

    console.log(`\n  ${job.kind}　${job.status}　${job.createdAt.toISOString().slice(0, 16)}`)
    console.log(`    模型 ${job.model || '（沒記）'}`)
    console.log(`    來源長度 ${sourceText.length.toLocaleString('en-US')} 字`)
    console.log(`    maxTokens ${String(request?.maxTokens ?? '（沒指定，吃預設）')}`)
    console.log(`    effort ${String(request?.effort ?? '（沒指定，吃每個任務的預設）')}`)
    console.log(`    估價 ${job.estimatedCost ?? '—'}　實際 ${job.actualCost ?? '—'}`)
    if (job.errorMessage) console.log(`    錯誤 ${job.errorMessage}`)

    const attempts = await db
      .select({
        attempt: aiJobAttempts.attempt,
        inputTokens: aiJobAttempts.inputTokens,
        outputTokens: aiJobAttempts.outputTokens,
        errorMessage: aiJobAttempts.errorMessage,
      })
      .from(aiJobAttempts)
      .where(eq(aiJobAttempts.jobId, job.id))
      .orderBy(aiJobAttempts.attempt)

    for (const attempt of attempts) {
      console.log(
        `      第 ${attempt.attempt} 次：in ${attempt.inputTokens} / out ${attempt.outputTokens}` +
          (attempt.errorMessage ? `　${attempt.errorMessage.slice(0, 120)}` : '')
      )
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
