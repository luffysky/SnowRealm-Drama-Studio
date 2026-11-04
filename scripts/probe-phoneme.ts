import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * `<phoneme>` 的正確寫法，逐類音色實測 (Z140).
 *
 * 關鍵是**聲調前面要有空格**：`ph="huan2"` 是 400，`ph="huan 2"` 是 200。
 * 上一輪就是漏了這個空格，才得出「zh-CN 不支援」那個錯結論。
 *
 * 每一類都附對照組（故意塞一個長很多的讀音）。狀態碼只說它收，長度變了才
 * 說它真的有作用。
 */
async function main() {
  const { synthesize, SpeechError } = await import('../src/lib/azure/speech')

  const voices = [
    'zh-TW-HsiaoChenNeural',
    'zh-CN-XiaoxiaoNeural',
    'zh-CN-shaanxi-XiaoniNeural',
    'zh-HK-HiuMaanNeural',
    'yue-CN-XiaoMinNeural',
    'wuu-CN-XiaotongNeural',
    'en-US-AvaMultilingualNeural',
  ]

  const cases: { label: string; inner: string }[] = [
    { label: '原樣', inner: '還錢' },
    { label: '注音', inner: '<phoneme alphabet="sapi" ph="ㄏㄨㄢˊ">還</phoneme>錢' },
    { label: '拼音 空格聲調', inner: '<phoneme alphabet="sapi" ph="huan 2">還</phoneme>錢' },
    { label: '拼音 兩個字', inner: '<phoneme alphabet="sapi" ph="huan 2 qian 2">還錢</phoneme>' },
    { label: '對照 注音長', inner: '<phoneme alphabet="sapi" ph="ㄇㄚˇㄌㄧˋㄧㄚˋㄋㄚˋ">還</phoneme>錢' },
    { label: '對照 拼音長', inner: '<phoneme alphabet="sapi" ph="ma 3 li 4 ya 4 na 4">還</phoneme>錢' },
  ]

  for (const voice of voices) {
    console.log(`\n=== ${voice} ===`)
    for (const row of cases) {
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">` +
        `<voice name="${voice}">${row.inner}</voice></speak>`
      try {
        const bytes = await synthesize(ssml)
        console.log(`  ${row.label.padEnd(14)} 200  ${bytes.length}`)
      } catch (cause) {
        console.log(`  ${row.label.padEnd(14)} ${cause instanceof SpeechError ? cause.status : '??'}`)
      }
    }
  }

  process.exit(0)
}

void main()
