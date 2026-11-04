import { createHash } from 'node:crypto'
import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * Azure 自己會不會看前後文判斷破音字？
 *
 * 測法：同一句話，一次不指定讀音，一次指定 A，一次指定 B。
 * 不指定的音檔跟哪一個一樣，就代表它自己判成哪一個。
 * 這比「聽聽看」準，也比看文件準。
 */
async function main() {
  const { synthesize } = await import('../src/lib/azure/speech')
  const VOICE = 'zh-CN-XiaoxiaoNeural'

  const hash = async (body: string) => {
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
      `<voice name="${VOICE}">${body}</voice></speak>`
    return createHash('sha256').update(await synthesize(ssml)).digest('hex').slice(0, 10)
  }

  /** [句子, 破音字, 讀音A, 讀音B, A 的意思, B 的意思] */
  const cases: [string, string, string, string, string, string][] = [
    ['他還有三文錢', '還', 'hai 2', 'huan 2', 'ㄏㄞˊ', 'ㄏㄨㄢˊ'],
    ['他把被子還給我', '還', 'hai 2', 'huan 2', 'ㄏㄞˊ', 'ㄏㄨㄢˊ'],
    ['這條路很長', '長', 'chang 2', 'zhang 3', 'ㄔㄤˊ', 'ㄓㄤˇ'],
    ['他長大了', '長', 'chang 2', 'zhang 3', 'ㄔㄤˊ', 'ㄓㄤˇ'],
    ['這行字', '行', 'hang 2', 'xing 2', 'ㄏㄤˊ', 'ㄒㄧㄥˊ'],
    ['他行得正', '行', 'hang 2', 'xing 2', 'ㄏㄤˊ', 'ㄒㄧㄥˊ'],
    ['重新開始', '重', 'chong 2', 'zhong 4', 'ㄔㄨㄥˊ', 'ㄓㄨㄥˋ'],
    ['這個很重', '重', 'chong 2', 'zhong 4', 'ㄔㄨㄥˊ', 'ㄓㄨㄥˋ'],
    ['沈知味', '沈', 'shen 3', 'chen 2', 'ㄕㄣˇ(姓)', 'ㄔㄣˊ'],
  ]

  console.log('  句子                   自動判讀')
  for (const [sentence, char, phA, phB, labelA, labelB] of cases) {
    const mark = (ph: string) =>
      sentence.replace(char, `<phoneme alphabet="sapi" ph="${ph}">${char}</phoneme>`)

    const [plain, a, b] = await Promise.all([hash(sentence), hash(mark(phA)), hash(mark(phB))])

    const verdict =
      plain === a ? `判成 ${labelA}` : plain === b ? `判成 ${labelB}` : '兩個都不一樣（無法判定）'

    console.log(`  ${sentence.padEnd(12)} ${verdict}`)
  }
  process.exit(0)
}
void main()
