/**
 * 把 17 種 AI 任務真的各跑一次 (Z179).
 *
 *   node scripts/check-ai-live.mjs                 # 全部跑一遍，跑完丟掉測試任務
 *   node scripts/check-ai-live.mjs --keep          # 保留任務，留在收件匣裡看
 *   node scripts/check-ai-live.mjs --only TASK,...  # 只跑指定的幾種
 *
 * ## 為什麼要有這一支，而 `check:ai` 不夠
 *
 * `scripts/check-ai-tasks.ts` 是靜態掃描：它證明「每一種任務都有一顆按鈕叫得
 * 動它」。它證明不了的是**叫下去之後會發生什麼**——prompt 送不送得出去、模型
 * 回的東西讀不讀得懂、思考額度會不會把輸出吃光。那三件事只有真的打一次才知
 * 道，而它們正是 11-05 那筆 `NOVEL_TO_SCRIPT` 失敗的原因。
 *
 * ## 這支會花錢，所以**不在** `npm run check` 裡
 *
 * 每一種任務一次呼叫，用 Claude（文字）。17 次加起來大約是幾分美金，但它仍然
 * 是真的帳單，而提交門檻應該是免費又快的——一個會花錢的門檻，第三天就會有人
 * 想辦法繞過去。
 *
 * ## 都走 Claude，即使那不是正式的指派
 *
 * 七家相容廠商只有 Anthropic 這一把金鑰在。要驗的是**接線**（prompt → 供應商
 * → 解析 → 寫回），而接線跟換哪一家無關：`OPENAI_COMPATIBLE` 那一支適配器是
 * 同一條路，只差 base URL 與金鑰。所以先用 Claude 打通，換家的時候只要測那一
 * 家的連線就好。
 */
import { readFileSync } from 'node:fs'
import { signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}

const base = 'http://127.0.0.1:3400'
const keep = process.argv.includes('--keep')
const onlyArg = process.argv[process.argv.indexOf('--only') + 1]
const only = process.argv.includes('--only') && onlyArg ? onlyArg.split(',') : null

const cookies = await signIn(base, 'collaborator')
const jar = Object.entries(cookies)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ')

const api = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: jar,
      origin: base,
      'x-csrf-token': cookies.srds_csrf ?? '',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 300) }
  }
  return { status: response.status, body }
}

/* ------------------------------------------------------------ 供應商 */

console.log('\n=== 1. AI 供應商 ===')

const { Client } = await import('pg')
const pg = new Client({ connectionString: process.env.DATABASE_URL })
await pg.connect()

let [provider] = (
  await pg.query("select id, label, enabled, default_model from ai_providers where kind = 'ANTHROPIC'")
).rows

if (!provider) {
  console.log('  沒有 ANTHROPIC 供應商，建立一個（金鑰讀 ANTHROPIC_API_KEY，不寫進資料庫）')
  const created = await api('/api/ai/providers', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'ANTHROPIC',
      label: 'Claude（文字）',
      envVarName: 'ANTHROPIC_API_KEY',
      enabled: true,
    }),
  })
  if (created.status >= 300) {
    console.log('  ✗ 建立失敗', created.status, JSON.stringify(created.body).slice(0, 200))
    process.exit(1)
  }
  ;[provider] = (
    await pg.query("select id, label, enabled, default_model from ai_providers where kind = 'ANTHROPIC'")
  ).rows
  console.log('  ✓ 建好了：', provider.id)
} else {
  console.log('  已存在：', provider.label, provider.id, 'enabled =', provider.enabled)
}

const tested = await api(`/api/ai/providers/${provider.id}/test`, { method: 'POST' })
console.log(
  `  連線測試 → HTTP ${tested.status}`,
  JSON.stringify(tested.body?.data ?? tested.body).slice(0, 220)
)

/* ------------------------------------------------------------ 取素材 */

const project = (
  await pg.query("select id from projects where title = '一灶見山河' limit 1")
).rows[0]
const episode = (
  await pg.query('select id from episodes where project_id = $1 order by number limit 1', [
    project.id,
  ])
).rows[0]
/*
 * 小說正文要跟 `episodeId` **同一集**.
 *
 * 第一版我挑「全專案字數最少、超過 500 字的那一份」，結果它屬於另一集——
 * 而模型抓到了：它回 `{"scenes": [], "issues": ["來源內容與製作對象不符…"]}`。
 * 腳本當時判成 ✓（任務確實跑完了），但那一次**根本沒有測到改編**。
 *
 * 測試素材選錯，比測試壞掉更難發現：綠的。
 */
const novelDoc = (
  await pg.query(
    "select d.id, d.episode_id from documents d where d.episode_id = $1 and d.kind = 'NOVEL' limit 1",
    [episode.id]
  )
).rows[0]
/*
 * 挑**資料最多**的角色，不是第一個.
 *
 * 第一版照名字排序，挑到「周圍的百姓」——一個群眾條目，沒有年齡、沒有性格、
 * 沒有簡介。模型於是四格全空地回來，而那是**正確行為**
 * （`parseDesign` 看到全空會回 null，拒絕寫入），只是它什麼都沒測到。
 *
 * 這跟上面小說選錯集是同一件事：素材選得不對，測試會綠，而綠的理由跟你以為
 * 的不一樣。
 */
const character = (
  await pg.query(
    `select id, name,
            length(coalesce(background,'')) + length(coalesce(personality,''))
              + length(coalesce(growth,'')) + length(coalesce(age,'')) as filled
       from characters
      where project_id = $1 and deleted_at is null
      order by filled desc
      limit 1`,
    [project.id]
  )
).rows[0]

console.log(
  '\n素材：project',
  project.id,
  '/ episode',
  episode.id,
  '/ 同集小說',
  novelDoc?.id ?? '（這一集沒有小說）',
  '/ 角色',
  character?.name ?? '（沒有）'
)

/* ------------------------------------------------------------ 任務 */

const SOURCE = '沈知味掀開鍋蓋，白霧撲了她一臉。灶上那鍋湯滾了三個時辰，她盯著水面上浮起的油花，忽然想起師父說過的話。'

/** 每一種任務要帶什麼。`route` 不是 /api/ai/jobs 的，走自己的路。 */
const TASKS = [
  { task: 'PROJECT_PLAN', body: { projectId: project.id, userInstruction: '請提出一個短劇企劃方向' } },
  { task: 'OUTLINE_GENERATE', body: { projectId: project.id, userInstruction: '請寫三集的大綱' } },
  { task: 'OUTLINE_REVIEW', body: { projectId: project.id, sourceText: '第一集：沈知味重生回到十六歲。第二集：她做出第一碗麵。' } },
  { task: 'NOVEL_CONTINUE', body: { projectId: project.id, episodeId: episode.id, sourceText: SOURCE } },
  { task: 'NOVEL_REWRITE', body: { projectId: project.id, sourceText: SOURCE, userInstruction: '改得更有畫面感' } },
  { task: 'NOVEL_POLISH', body: { projectId: project.id, sourceText: SOURCE } },
  { task: 'NOVEL_REVIEW', body: { projectId: project.id, sourceText: SOURCE } },
  { task: 'NOVEL_TO_SCRIPT', body: { projectId: project.id, episodeId: episode.id, novelEpisodeId: novelDoc?.episode_id ?? episode.id } },
  { task: 'SCRIPT_ANALYZE', body: { projectId: project.id, sourceText: SOURCE } },
  { task: 'WORLD_GENERATE', body: { projectId: project.id, userInstruction: '請建立這部作品的世界觀條目' } },
  { task: 'WORLD_CONSISTENCY', body: { projectId: project.id, sourceText: SOURCE } },
  { task: 'CHARACTER_DESIGN', body: { projectId: project.id, userInstruction: '請寫一版外觀與聲線' } },
  { task: 'STORYBOARD_GENERATE', body: { projectId: project.id, episodeId: episode.id, sourceText: SOURCE } },
  { task: 'ASSET_GENERATE', body: { projectId: project.id, userInstruction: '灶房的清晨，一鍋熱湯' } },
  { task: 'TASK_SUGGEST', body: { projectId: project.id } },
]

const results = []

const runWorker = async () => api('/api/ai/worker?limit=1', { method: 'GET' })

for (const entry of TASKS) {
  if (only && !only.includes(entry.task)) continue

  const label = entry.task.padEnd(22)
  const created = await api('/api/ai/jobs', {
    method: 'POST',
    body: JSON.stringify({ ...entry.body, task: entry.task, candidates: 1 }),
  })

  if (created.status >= 300) {
    const message = created.body?.error?.message ?? JSON.stringify(created.body).slice(0, 160)
    console.log(`  ✗ ${label} 建立任務失敗 HTTP ${created.status}  ${message}`)
    results.push({ task: entry.task, ok: false, stage: '建立', detail: message })
    continue
  }

  /*
   * `jsonOk(data)` 是把 data 直接當 body，**沒有 `{ data: … }` 那一層**.
   *
   * 第一版我照著「API 回應都包一層」的習慣寫 `body.data.job.id`，拿到
   * undefined——於是 jobId 是 undefined、輪詢打的是 `/api/ai/jobs/undefined`、
   * status 永遠停在我自己給的預設值 `'QUEUED'`，而**任務其實跑成功了**。
   * 腳本報「卡在 QUEUED、沒有錯誤訊息」，資料庫裡卻是 `AWAITING_REVIEW`。
   *
   * 一個把「我讀錯欄位」說成「功能壞了」的檢查工具，比沒有檢查工具更糟。
   */
  const jobId = created.body?.job?.id
  if (!jobId) {
    console.log(`  ✗ ${label} 回應裡找不到 job.id：${JSON.stringify(created.body).slice(0, 160)}`)
    results.push({ task: entry.task, ok: false, stage: '回應格式', detail: '沒有 job.id' })
    continue
  }
  let status = created.body?.job?.status ?? 'QUEUED'
  let job = null

  /*
   * 每打一次 worker 就跑一筆。重試上限是**次數**不是時間：一個卡住的任務用
   * 時間等只會讓整支腳本變慢，而 `stuck` 本身就是要回報的結果。
   */
  for (let attempt = 0; attempt < 12 && (status === 'QUEUED' || status === 'RUNNING'); attempt += 1) {
    await runWorker()
    const polled = await api(`/api/ai/jobs/${jobId}`)
    job = polled.body?.job ?? polled.body ?? null
    status = job?.status ?? status
  }

  const ok = status === 'AWAITING_REVIEW' || status === 'SUCCEEDED'
  const candidate = job?.result?.candidates?.[0]?.content ?? ''
  const detail = ok
    ? `${String(candidate).replace(/\s+/g, ' ').slice(0, 70)}…`
    : (job?.errorMessage ?? '（沒有錯誤訊息）').replace(/\s+/g, ' ').slice(0, 110)

  console.log(`  ${ok ? '✓' : '✗'} ${label} ${String(status).padEnd(16)} ${detail}`)
  results.push({ task: entry.task, ok, stage: status, detail, jobId })

  if (!keep && jobId) await api(`/api/ai/jobs/${jobId}/discard`, { method: 'POST' })
}

/* --------------------------------------------- 走自己路由的那幾種 */

/**
 * 三種任務不在 `aiRunSchema.task` 的列舉裡，各自有專屬端點.
 *
 * 那是刻意的（「不是每一種任務都該讓前端直接點名」），但代價是**它們不會被
 * 上面那個迴圈測到**——而「所有任務都測過了」正是這支腳本想講的話。
 */
const DEDICATED = [
  {
    task: 'CHARACTER_DESIGN',
    skip: !character && '這個作品沒有角色',
    path: () => `/api/projects/${project.id}/characters/${character.id}/design`,
  },
  {
    task: 'DIALOGUE_ATTRIBUTE',
    skip: !novelDoc && '這一集沒有小說正文',
    path: () => `/api/projects/${project.id}/episodes/${episode.id}/attribution`,
  },
  {
    task: 'NOVEL_TO_AUDIO',
    skip:
      !process.argv.includes('--audio') &&
      '要加 --audio 才跑：它會真的合成整集語音、寫進 R2、按字數計費',
    path: () => `/api/projects/${project.id}/episodes/${episode.id}/audiobook`,
    body: {},
  },
]

console.log('\n=== 3. 走專屬端點的三種 ===')

for (const entry of DEDICATED) {
  if (only && !only.includes(entry.task)) continue
  const label = entry.task.padEnd(22)

  if (entry.skip) {
    console.log(`  · ${label} 跳過：${entry.skip}`)
    continue
  }

  const created = await api(entry.path(), {
    method: 'POST',
    ...(entry.body ? { body: JSON.stringify(entry.body) } : {}),
  })

  if (created.status >= 300) {
    const message = created.body?.error?.message ?? JSON.stringify(created.body).slice(0, 160)
    console.log(`  ✗ ${label} HTTP ${created.status}  ${message}`)
    results.push({ task: entry.task, ok: false, stage: `HTTP ${created.status}`, detail: message })
    continue
  }

  const jobId = created.body?.jobId ?? created.body?.job?.id
  if (!jobId) {
    console.log(`  ✗ ${label} 回應裡找不到 jobId：${JSON.stringify(created.body).slice(0, 160)}`)
    results.push({ task: entry.task, ok: false, stage: '回應格式', detail: '沒有 jobId' })
    continue
  }

  let status = 'QUEUED'
  let job = null
  for (let attempt = 0; attempt < 20 && (status === 'QUEUED' || status === 'RUNNING' || status === 'AWAITING_PROVIDER'); attempt += 1) {
    await runWorker()
    const polled = await api(`/api/ai/jobs/${jobId}`)
    job = polled.body?.job ?? polled.body ?? null
    status = job?.status ?? status
  }

  const ok = status === 'AWAITING_REVIEW' || status === 'SUCCEEDED'
  const candidate = job?.result?.candidates?.[0]?.content ?? ''
  const detail = ok
    ? `${String(candidate).replace(/\s+/g, ' ').slice(0, 70)}…`
    : (job?.errorMessage ?? '（沒有錯誤訊息）').replace(/\s+/g, ' ').slice(0, 110)

  console.log(`  ${ok ? '✓' : '✗'} ${label} ${String(status).padEnd(16)} ${detail}`)
  results.push({ task: entry.task, ok, stage: status, detail, jobId })

  // 有聲書寫的是真的素材，丟掉任務不會把它們收回來，所以一律保留它的紀錄。
  if (!keep && jobId && entry.task !== 'NOVEL_TO_AUDIO') {
    await api(`/api/ai/jobs/${jobId}/discard`, { method: 'POST' })
  }
}

/* ------------------------------------------------------------ 總結 */

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 總結：${results.length - failed.length} / ${results.length} 跑得起來 ===`)
for (const f of failed) console.log(`  ✗ ${f.task}  ${f.stage}  ${f.detail}`)
if (!keep) console.log('\n（測試任務已丟棄，收件匣不會被洗版。要保留加 --keep）')

await pg.end()
process.exit(failed.length === 0 ? 0 : 1)
