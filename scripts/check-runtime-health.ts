import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 每天該看一眼的執行期狀態，本機版 (Z159/Z161).
 *
 * 判斷邏輯在 `src/lib/health.ts`，這裡只負責把它印得好看。同一份判斷有兩個
 * 入口——這支腳本，以及每日排程打的 `/api/health`——而兩份各寫一次的下場，
 * 今天已經在 `estimate()` 跟 `run()`、`max-height` 跟 `bottom` 上看過兩次了。
 *
 * 跟 `check-dead-wiring.ts` 分開跑：那支掃程式碼，程式碼不變它就不會變，所
 * 以放在提交門檻上；這支看的東西每天都在動，而且壞掉的時候沒有人會收到通知。
 */
async function main() {
  const { healthReport } = await import('../src/lib/health')
  const report = await healthReport()

  console.log(`  資料庫：${report.database}\n`)

  console.log('  ## AI 佇列')
  console.log(
    `  失敗 ${report.jobs.failed}　排隊中 ${report.jobs.queued}　` +
      `執行中 ${report.jobs.running}　等人確認 ${report.jobs.awaitingReview}`
  )
  for (const failure of report.jobs.recentFailures) {
    console.log(`    ${failure.kind}：${failure.message.slice(0, 90)}`)
  }

  console.log('\n  ## 匯率')
  console.log(`  ${report.fx.base}　asOf ${report.fx.asOf}　來源「${report.fx.source}」`)
  if (report.fx.ageDays !== null) console.log(`  距今 ${report.fx.ageDays.toFixed(1)} 天`)

  console.log('\n  ## 定稿鎖')
  console.log(`  目前鎖住 ${report.locks.total} 份　其中 ${report.locks.stale} 份超過一週`)

  console.log('\n  ## 本月花費')
  console.log(`  ${report.spend.monthToDateUsd.toFixed(4)} USD（${report.spend.since} 起）`)

  console.log(`\n  ## 作品\n  ${report.projects} 部`)

  console.log('')
  if (report.problems.length === 0 && report.notes.length === 0) {
    console.log('  ✓ 沒有需要處理的')
    return
  }

  for (const note of report.notes) console.log(`  ⚠ ${note}`)
  for (const problem of report.problems) console.log(`  ✗ ${problem}`)

  if (report.problems.length > 0) process.exitCode = 1
}

main().then(
  () => {},
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
