import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { db } = await import('../src/db')
  const { aiProviders } = await import('../src/db/schema')
  const rows = await db.select().from(aiProviders)
  console.log(`  ${rows.length} 筆`)
  for (const r of rows) {
    console.log(`  ${r.kind}  ${r.label}  enabled=${r.enabled}  key=⋯${r.apiKeyLast4 || '無'}  env=${r.envVarName || '無'}`)
  }
  process.exit(0)
}
void main()
