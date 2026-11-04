import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 指定讀音到底有沒有生效——合成完再讓 Azure 自己聽回去。
 *
 * hash 比對不成立：同一份 SSML 送兩次，回來的 bytes 就不一樣。所以改用
 * 語音轉文字——「沈」指定成 chen2，辨識回來應該變成同音的別字。
 *
 * 序列執行而且留間隔：免費層有每分鐘請求上限，平行打會拿到 429。
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { synthesize, transcribe } = await import('../src/lib/azure/speech')

  const say = async (label: string, body: string) => {
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
      `<voice name="zh-CN-XiaoxiaoNeural">${body}</voice></speak>`
    const audio = await synthesize(ssml)
    await wait(4000)
    const heard = await transcribe({
      audio,
      mimeType: 'audio/mpeg',
      fileName: 'probe.mp3',
      locales: ['zh-CN'],
    })
    await wait(4000)
    console.log(`    ${label.padEnd(16)} → 「${heard.text.replace(/[。，、？！\s]/g, '')}」`)
    return heard.text.replace(/[。，、？！\s]/g, '')
  }

  const text = '沈知味'
  const tag = (ph: string) =>
    text.replace('沈', `<phoneme alphabet="sapi" ph="${ph}">沈</phoneme>`)

  console.log(`  原文「${text}」，讓 Azure 唸完再自己聽回去：`)
  const plain = await say('不指定', text)
  const shen = await say('指定 shen 3', tag('shen 3'))
  const chen = await say('指定 chen 2', tag('chen 2'))

  console.log()
  console.log(`  指定兩種讀音的辨識結果：${shen === chen ? '相同 → 看不出指定有生效' : '不同 → 指定確實生效'}`)
  if (plain === shen && plain !== chen) console.log('  自動判讀 = shen 3（姓氏，正確）')
  else if (plain === chen && plain !== shen) console.log('  自動判讀 = chen 2（唸錯了）')
  else console.log('  自動判讀：跟兩者都一樣或都不一樣，判不出來')
  process.exit(0)
}
void main()
