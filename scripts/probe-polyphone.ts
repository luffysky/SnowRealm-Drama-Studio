import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 破音字能不能指定讀音——實際打，不看文件。
 *
 * 兩個問題：語法對不對（會不會 400），以及指定了到底有沒有差（兩個讀音的
 * 音檔應該不一樣，長度跟雜湊都會不同）。
 */
async function main() {
  const { synthesize } = await import('../src/lib/azure/speech')

  const cases: [string, string, string][] = [
    ['zh-CN 不指定', 'zh-CN-XiaoxiaoNeural', '他還沒還錢。'],
    [
      'zh-CN 指定 hai2',
      'zh-CN-XiaoxiaoNeural',
      '他<phoneme alphabet="sapi" ph="hai 2">還</phoneme>沒還錢。',
    ],
    [
      'zh-CN 指定 huan2',
      'zh-CN-XiaoxiaoNeural',
      '他<phoneme alphabet="sapi" ph="huan 2">還</phoneme>沒還錢。',
    ],
    ['zh-TW 不指定', 'zh-TW-HsiaoChenNeural', '他還沒還錢。'],
    [
      'zh-TW 送拼音（預期失敗）',
      'zh-TW-HsiaoChenNeural',
      '他<phoneme alphabet="sapi" ph="hai 2">還</phoneme>沒還錢。',
    ],
    [
      'zh-TW 送注音',
      'zh-TW-HsiaoChenNeural',
      '他<phoneme alphabet="sapi" ph="ㄏㄞˊ">還</phoneme>沒還錢。',
    ],
    [
      'zh-CN 姓沈 shen3',
      'zh-CN-XiaoxiaoNeural',
      '<phoneme alphabet="sapi" ph="shen 3">沈</phoneme>知味',
    ],
    ['zh-CN 姓沈 不指定', 'zh-CN-XiaoxiaoNeural', '沈知味'],
  ]

  for (const [label, voice, body] of cases) {
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
      `xml:lang="${voice.startsWith('zh-TW') ? 'zh-TW' : 'zh-CN'}">` +
      `<voice name="${voice}">${body}</voice></speak>`

    try {
      const audio = await synthesize(ssml)
      const hash = createHash('sha256').update(audio).digest('hex').slice(0, 12)
      console.log(`  ${label.padEnd(24)} ✓ ${String(audio.length).padStart(7)} bytes  ${hash}`)
      writeFileSync(`.shots/poly-${label.replace(/[^\w]/g, '_')}.mp3`, audio)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.log(`  ${label.padEnd(24)} ✗ ${message.slice(0, 110)}`)
    }
  }
  process.exit(0)
}
void main()
