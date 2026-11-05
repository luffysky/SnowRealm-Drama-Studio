import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 每一種任務實際會用的思考程度與輸出額度 (Z157).
 *
 * 不呼叫模型，所以不花錢。它問的是「如果現在送出去，會用哪一組設定」——而那
 * 正是壞掉的地方：`TASK_EFFORT` 那張表存在、看起來正常、**從來沒有被讀到
 * 過**，因為佇列在它之前就把 `'high'` 蓋上去了。
 *
 * 加上 `--queued` 可以順便看佇列裡既有的任務存的是什麼。
 */
async function main() {
  const { AI_JOB_KINDS } = await import('../src/lib/constants')
  const { resolveEffort, resolveMaxTokens } = await import('../src/lib/ai/budget')
  const { DEFAULT_MAX_OUTPUT_TOKENS } = await import('../src/lib/ai/anthropic')
  const { getTaskProfiles } = await import('../src/lib/settings')

  const profiles = await getTaskProfiles({})
  const stored = Object.keys(profiles).length

  console.log(
    `  全域預設上限 ${DEFAULT_MAX_OUTPUT_TOKENS} token　` +
      `系統設定裡有 ${stored} 筆任務設定\n`
  )
  console.log('  任務                     思考      上限')

  for (const kind of AI_JOB_KINDS) {
    // 有聲書不是送給語言模型的任務，沒有思考程度可言。
    if (kind === 'NOVEL_TO_AUDIO') continue

    const task = kind as Parameters<typeof resolveEffort>[0]['task']
    const profile = profiles[kind]

    const effort = resolveEffort({
      task,
      requested: null,
      profile: profile?.effort ?? null,
    })
    const maxTokens = resolveMaxTokens({
      task,
      requested: null,
      profile: profile?.maxTokens ?? null,
      fallback: DEFAULT_MAX_OUTPUT_TOKENS,
    })

    const flag = maxTokens > DEFAULT_MAX_OUTPUT_TOKENS ? ' ←加大' : ''
    console.log(`  ${kind.padEnd(22)} ${effort.padEnd(8)} ${String(maxTokens).padStart(6)}${flag}`)
  }

  if (!process.argv.includes('--queued')) return

  const { db } = await import('../src/db')
  const { aiJobs } = await import('../src/db/schema')
  const { desc } = await import('drizzle-orm')

  const jobs = await db
    .select({ kind: aiJobs.kind, status: aiJobs.status, request: aiJobs.request })
    .from(aiJobs)
    .orderBy(desc(aiJobs.createdAt))
    .limit(10)

  console.log('\n  佇列裡最近十筆存的 effort：')
  for (const job of jobs) {
    const request = job.request as { effort?: unknown } | null
    const value = request?.effort
    const note = value === null || value === undefined ? '（沒指定，走優先序）' : String(value)
    console.log(`    ${job.kind.padEnd(22)} ${job.status.padEnd(16)} ${note}`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
