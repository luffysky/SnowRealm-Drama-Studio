import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * Azure 會不會用前後文判斷破音字——你的例子，實測。
 *
 * 判法：同一句話合成三次（不指定 / 指定讀音A / 指定讀音B），每次都讓 Azure
 * 自己聽回去。不指定的辨識結果跟哪一個一樣，就是它自己判成哪一個。
 *
 * hash 比對不能用：同一份 SSML 送兩次回來的 bytes 就不一樣。
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { synthesize, transcribe } = await import('../src/lib/azure/speech')

  const say = async (body: string) => {
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
      `<voice name="zh-CN-XiaoxiaoNeural">${body}</voice></speak>`
    const audio = await synthesize(ssml)
    await wait(3500)
    const heard = await transcribe({ audio, mimeType: 'audio/mpeg', fileName: 'p.mp3', locales: ['zh-CN'] })
    await wait(3500)
    return heard.text.replace(/[。，、？！\s]/g, '')
  }

  const cases: [string, string, string, string, string, string][] = [
    ['他還有三文錢', '還', 'hai 2', 'huan 2', 'ㄏㄞˊ', 'ㄏㄨㄢˊ'],
    ['他還被子給我', '還', 'hai 2', 'huan 2', 'ㄏㄞˊ', 'ㄏㄨㄢˊ'],
  ]

  for (const [text, char, phA, phB, labelA, labelB] of cases) {
    const tag = (ph: string) =>
      text.replace(char, `<phoneme alphabet="sapi" ph="${ph}">${char}</phoneme>`)

    const plain = await say(text)
    const a = await say(tag(phA))
    const b = await say(tag(phB))

    console.log(`  「${text}」  應該唸 ${text.includes('有') ? labelA : labelB}`)
    console.log(`    不指定        → 「${plain}」`)
    console.log(`    指定 ${labelA}     → 「${a}」`)
    console.log(`    指定 ${labelB}   → 「${b}」`)

    const verdict =
      a === b
        ? '兩種讀音聽起來一樣，判不出來'
        : plain === a
          ? `自動判成 ${labelA}`
          : plain === b
            ? `自動判成 ${labelB}`
            : '跟兩者都不一樣，判不出來'
    console.log(`    → ${verdict}`)
    console.log()
  }
  process.exit(0)
}
void main()
