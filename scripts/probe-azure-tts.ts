import { writeFileSync } from 'node:fs'
import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** Proves the whole path: SSML in, playable audio out. */
async function main() {
  const { synthesize } = await import('../src/lib/azure/speech')
  const { ssmlFor } = await import('../src/lib/tts/ssml')
  const { TONE_SHAPE, DIALOGUE_SHAPE } = await import('../src/lib/narration')

  const chunks = [
    { text: '灶上的火光跳了一下。', paragraph: 0 },
    {
      text: '「這能買什麼？」',
      paragraph: 1,
      voiceId: 'zh-TW-HsiaoYuNeural',
      rate: TONE_SHAPE.question.rate * DIALOGUE_SHAPE.rate,
      pitch: TONE_SHAPE.question.pitch * DIALOGUE_SHAPE.pitch,
    },
    { text: '沒有人回答。', paragraph: 2 },
    {
      text: '「買一鍋雞皮，夠了。」',
      paragraph: 3,
      voiceId: 'zh-TW-YunJheNeural',
      rate: DIALOGUE_SHAPE.rate,
      pitch: DIALOGUE_SHAPE.pitch,
    },
  ]

  const ssml = ssmlFor(chunks, { locale: 'zh-TW', narratorVoice: 'zh-TW-HsiaoChenNeural' })
  console.log(`  SSML ${ssml.length} 字元，正文 ${chunks.reduce((n, c) => n + c.text.length, 0)} 字`)

  const started = Date.now()
  const audio = await synthesize(ssml)
  const seconds = (Date.now() - started) / 1000

  const out = '.shots/tts-sample.mp3'
  writeFileSync(out, audio)

  const spokenChars = chunks.reduce((n, c) => n + c.text.length, 0)
  console.log(`  合成耗時 ${seconds.toFixed(1)} 秒，產出 ${(audio.length / 1024).toFixed(1)} KB`)
  console.log(`  估算音檔長度約 ${(spokenChars / 3.9).toFixed(1)} 秒`)
  console.log(`  合成速度約為實時的 ${(spokenChars / 3.9 / seconds).toFixed(1)} 倍`)
  console.log(`  檔案：${out}`)
  process.exit(0)
}
void main()
