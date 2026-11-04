import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * Tries the key against several regions at once.
 *
 * A 401 says 「key or endpoint」 without saying which, so the only way to tell
 * them apart is to hold the key still and vary the endpoint. If every region
 * refuses it, the region was never the problem.
 */
async function main() {
  const key = (process.env.AZURE_SPEECH_KEY ?? '').trim().replace(/^["']|["']$/g, '')
  if (!key) throw new Error('沒有 AZURE_SPEECH_KEY')

  const regions = [
    'japanwest', 'japaneast', 'eastasia', 'southeastasia',
    'eastus', 'westeurope',
  ]

  console.log(`  金鑰長度 ${key.length}，字元組成 ${/^[A-Za-z0-9]+$/.test(key) ? '純英數' : '含其他字元'}`)

  for (const region of regions) {
    try {
      const response = await fetch(
        `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
        { headers: { 'Ocp-Apim-Subscription-Key': key } }
      )
      const note = response.ok
        ? `✓ 可以用（${((await response.json()) as unknown[]).length} 個音色）`
        : `HTTP ${response.status}`
      console.log(`  ${region.padEnd(14)} ${note}`)
    } catch (cause) {
      console.log(`  ${region.padEnd(14)} 連不上：${cause instanceof Error ? cause.message : cause}`)
    }
  }
  process.exit(0)
}
void main()
