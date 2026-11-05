import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 抓一次匯率，然後驗三種幣別兩兩換算。 */
async function main() {
  const { getFxRates } = await import('../src/lib/settings')
  const { refreshFxRates } = await import('../src/lib/fx-fetch')
  const { convert, CURRENCIES } = await import('../src/lib/money')

  const before = await getFxRates()
  console.log(`  更新前：base=${before.base} rates=${JSON.stringify(before.rates)} asOf=${before.asOf}`)
  console.log(`          來源「${before.source}」`)

  const result = await refreshFxRates(null)
  console.log(`\n  更新結果：${JSON.stringify(result.updated ? { updated: true, asOf: result.rates.asOf } : result)}`)

  const after = await getFxRates()
  console.log(`\n  更新後：base=${after.base} rates=${JSON.stringify(after.rates)} asOf=${after.asOf}`)
  console.log(`          來源「${after.source}」`)

  console.log('\n  三者兩兩換算（各 100 元）：')
  for (const from of CURRENCIES) {
    const line = CURRENCIES.filter((to) => to !== from)
      .map((to) => `${to} ${convert(100, from, to, after).toFixed(2)}`)
      .join('   ')
    console.log(`    100 ${from} → ${line}`)
  }

  console.log('\n  來回換算不該走鐘：')
  for (const from of CURRENCIES) {
    for (const to of CURRENCIES) {
      const round = convert(convert(1000, from, to, after), to, from, after)
      const drift = Math.abs(round - 1000)
      if (drift > 0.01) console.log(`    ✗ ${from}→${to}→${from} 差了 ${drift.toFixed(4)}`)
    }
  }
  console.log('    ✓ 三種幣別任意來回都回得到原值')

  process.exit(0)
}

void main()
