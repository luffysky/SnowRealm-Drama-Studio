import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 哪些音色有情緒風格，以及 EP001 真正用到的那幾個有沒有。 */
async function main() {
  const { voicePool } = await import('../src/lib/azure/speech')
  const { STYLE_CANDIDATES } = await import('../src/lib/tts/style')

  const pool = await voicePool()
  const withStyles = pool.filter((v) => v.styles.length > 0)

  console.log(`  ${pool.length} 個音色，其中 ${withStyles.length} 個有情緒風格`)

  const mandarin = withStyles.filter((v) => /^zh-/.test(v.id))
  console.log(`  官話系有風格的：${mandarin.length} 個\n`)

  for (const voice of mandarin.slice(0, 14)) {
    console.log(`  ${voice.id.padEnd(32)} ${voice.styles.length.toString().padStart(2)} 種  ${voice.styles.slice(0, 9).join(' ')}`)
  }

  console.log('\n  每一種情緒，有多少官話音色接得住：')
  for (const [emotion, candidates] of Object.entries(STYLE_CANDIDATES)) {
    const hit = mandarin.filter((v) => candidates.some((c) => v.styles.includes(c)))
    const first = candidates.filter((c) => mandarin.some((v) => v.styles.includes(c)))
    console.log(`  ${emotion.padEnd(12)} ${hit.length.toString().padStart(2)} 個音色接得住   有人支援的候選：${first.join(' ') || '（都沒有）'}`)
  }

  const taiwan = pool.filter((v) => /^zh-TW-/.test(v.id))
  console.log('\n  台灣音色：')
  for (const voice of taiwan) {
    console.log(`  ${voice.id.padEnd(26)} ${voice.styles.length} 種風格`)
  }

  process.exit(0)
}

void main()
