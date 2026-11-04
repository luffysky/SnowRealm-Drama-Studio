import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { listVoices } = await import('../src/lib/azure/speech')
  const all = await listVoices('zh')

  const byLocale = new Map<string, typeof all>()
  for (const v of all) {
    const list = byLocale.get(v.locale) ?? []
    list.push(v)
    byLocale.set(v.locale, list)
  }

  for (const [locale, list] of [...byLocale.entries()].sort()) {
    const f = list.filter((v) => /female/i.test(v.gender)).length
    const m = list.filter((v) => /^male/i.test(v.gender)).length
    console.log(`  ${locale}：${list.length} 個（女 ${f} / 男 ${m}）`)
  }

  console.log('\n  === zh-TW 全部 ===')
  for (const v of all.filter((v) => v.locale === 'zh-TW')) {
    console.log(`    ${v.id.padEnd(26)} ${v.gender.padEnd(7)} ${v.label}${v.styles.length ? `  風格：${v.styles.join('、')}` : ''}`)
  }

  const styled = all.filter((v) => v.locale.startsWith('zh-CN') && v.styles.length > 0)
  console.log(`\n  === zh-CN 有情緒風格的：${styled.length} 個（列前 8）===`)
  for (const v of styled.slice(0, 8)) {
    console.log(`    ${v.id.padEnd(26)} ${v.gender.padEnd(7)} 風格 ${v.styles.length} 種：${v.styles.slice(0, 6).join('、')}`)
  }
  process.exit(0)
}
void main()
