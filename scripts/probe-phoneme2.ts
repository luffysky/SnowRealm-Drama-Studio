import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 哪些音色**真的**照 `<phoneme>` 唸 (Z140).
 *
 * 收下來（200）跟照著唸是兩件事：zh-CN-Xiaoxiao 收了一個六音節的替代讀音，
 * 回來的位元組卻跟原樣一模一樣——那就是收下然後忽略。而「忽略」比「拒絕」
 * 難發現得多，因為它不會報錯，只會繼續唸錯。
 *
 * 所以這一支不看狀態碼，看**長度有沒有變**。定位元率 MP3 的長度就是時間，
 * 一個音節換成六個音節一定更長。
 */
async function main() {
  const { synthesize, SpeechError } = await import('../src/lib/azure/speech')
  const { voicePool } = await import('../src/lib/azure/speech')

  const pool = await voicePool()
  const candidates = pool.filter((v) => /^zh-(TW|CN)/.test(v.id)).map((v) => v.id)

  console.log(`  ${candidates.length} 個 zh-TW / zh-CN 音色\n`)

  const ssmlFor = (voice: string, inner: string) =>
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">` +
    `<voice name="${voice}">${inner}</voice></speak>`

  const honours: string[] = []
  const ignores: string[] = []
  const rejects: string[] = []

  for (const voice of candidates) {
    const long = voice.startsWith('zh-TW')
      ? 'ㄇㄚˇㄌㄧˋㄧㄚˋㄋㄚˋㄎㄚㄙㄚˋ'
      : 'ma 3 li 4 ya 4 na 4 ka 1 sa 4'

    let plainBytes = 0
    try {
      plainBytes = (await synthesize(ssmlFor(voice, '還錢'))).length
    } catch {
      console.log(`  ${voice.padEnd(30)} 原樣就失敗，跳過`)
      continue
    }

    try {
      const marked = (
        await synthesize(ssmlFor(voice, `<phoneme alphabet="sapi" ph="${long}">還</phoneme>錢`))
      ).length
      const delta = marked - plainBytes
      if (Math.abs(delta) < 400) {
        ignores.push(voice)
        console.log(`  ${voice.padEnd(30)} 200 但長度沒變（${plainBytes} → ${marked}）  ✗ 忽略`)
      } else {
        honours.push(voice)
        console.log(`  ${voice.padEnd(30)} 200 長度 ${plainBytes} → ${marked}  ✓ 照唸`)
      }
    } catch (cause) {
      rejects.push(voice)
      console.log(`  ${voice.padEnd(30)} ${cause instanceof SpeechError ? cause.status : '??'}  ✗ 拒絕`)
    }
  }

  console.log(`\n  照唸 ${honours.length}／忽略 ${ignores.length}／拒絕 ${rejects.length}`)
  console.log(`\n  照唸的：\n${honours.map((v) => `    ${v}`).join('\n')}`)
  if (ignores.length) console.log(`\n  忽略的：\n${ignores.map((v) => `    ${v}`).join('\n')}`)

  process.exit(0)
}

void main()
