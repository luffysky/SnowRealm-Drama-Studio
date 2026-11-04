import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { listVoices } = await import('../src/lib/azure/speech')
  const all = await listVoices()

  const count = (prefix: string) => all.filter((v) => v.locale.toLowerCase().startsWith(prefix))

  for (const [label, prefix] of [['英語 en', 'en'], ['日語 ja', 'ja'], ['韓語 ko', 'ko']] as const) {
    const list = count(prefix)
    const locales = [...new Set(list.map((v) => v.locale))].sort()
    const f = list.filter((v) => /female/i.test(v.gender)).length
    console.log(`  ${label}：${list.length} 個（女 ${f} / 男 ${list.length - f}），${locales.length} 個地區`)
    console.log(`    地區：${locales.slice(0, 12).join(' ')}${locales.length > 12 ? ' …' : ''}`)
  }

  const multi = all.filter((v) => /multilingual/i.test(v.id))
  console.log(`\n  === 多語言音色（同一把嗓子能講多國語言）：${multi.length} 個 ===`)
  for (const v of multi.slice(0, 14)) {
    console.log(`    ${v.id.padEnd(40)} ${v.gender.padEnd(7)} ${v.locale}`)
  }
  if (multi.length > 14) console.log(`    …還有 ${multi.length - 14} 個`)
  process.exit(0)
}
void main()
