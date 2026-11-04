import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { speechStatus, speechConfig } = await import('../src/lib/azure/speech')
  const config = speechConfig()
  console.log(`  設定：${config ? `region=${config.region}  金鑰長度=${config.key.length}` : '沒有'}`)
  const status = await speechStatus()
  console.log(`  可用：${status.available}`)
  console.log(`  說明：${status.detail}`)
  process.exit(0)
}
void main()
