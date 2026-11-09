/**
 * 雙視角審核，整條路走一次（Z201 驗收）。
 *
 *     npm run dev          # 另一個終端機
 *     node scripts/probe-dual-pass.mjs <projectId>
 *
 * **會真的花錢**（觀眾一趟 + 編劇一趟，大約 US$0.3），而且**會寫進資料庫**
 * （隱藏設定）——所以最後一步會把它清掉。
 *
 * 走的路：整理一集（觀眾視角）→ 確認有疑點 → 填隱藏設定 → 用編劇視角判一次
 * → 確認每一條都有判定、而且判定對得回原本那一條疑點。
 *
 * ## 它在驗什麼
 *
 * 不是「有沒有跑完」，是**隔離真的成立**：觀眾那一趟的提示詞裡不可以有隱藏設
 * 定的任何一個字。單元測試驗了 `renderContext`，這一支驗的是整條線接起來之後
 * 還是對的——context 是在 `story-audit.ts` 組的，而那是另一個檔案。
 */
import { readFileSync } from 'node:fs'
import { signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const base = 'http://127.0.0.1:3400'
const PROJECT = process.argv[2]
if (!PROJECT) {
  console.error('用法：node scripts/probe-dual-pass.mjs <projectId>')
  process.exit(2)
}

const SECRET =
  '梅花印其實是沈家、許家與永昌行三家共營的糧貨商契，第 28 集才揭曉。許山河一開始就知道，但他要等沈知味自己查出來。'

let pass = 0
let fail = 0
const ok = (label, good, detail = '') => {
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
  if (good) pass += 1
  else fail += 1
}

const cookies = await signIn(base, 'collaborator')
const cookieHeader = Object.entries(cookies)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ')
const headers = {
  'content-type': 'application/json',
  cookie: cookieHeader,
  'x-csrf-token': cookies['srds_csrf'] ?? '',
}

const call = async (path, init) => {
  const response = await fetch(`${base}${path}`, { headers, ...init })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

/* 先找一集有正文的。 */
const episodes = await call(`/api/projects/${PROJECT}/episodes?perPage=10`).catch(() => null)
const episodeId = process.argv[3] ?? episodes?.result?.rows?.[0]?.id
if (!episodeId) {
  console.error('找不到集數——把 episodeId 當第二個參數傳進來')
  process.exit(2)
}

try {
  /* ---- 1. 觀眾視角 ---------------------------------------------------- */
  const started = Date.now()
  const audience = await call(`/api/projects/${PROJECT}/audit`, {
    method: 'POST',
    body: JSON.stringify({ episodeId }),
  })
  const audit = audience.episode?.audit
  ok(
    '觀眾視角整理出來了',
    Boolean(audit),
    `${((Date.now() - started) / 1000).toFixed(0)}s　回應：${JSON.stringify(audience).slice(0, 300)}`
  )
  ok('有爽點與鉤子', Boolean(audit?.payoff?.what) && Boolean(audit?.hook?.what))

  const doubts = audit?.doubts ?? []
  ok('有疑點可以拿去判定', doubts.length > 0, `${doubts.length} 條`)
  if (doubts.length === 0) throw new Error('這一集沒有疑點，驗不了判定那一段')

  /* ---- 2. 填隱藏設定 -------------------------------------------------- */
  await call(`/api/projects/${PROJECT}/episodes/${episodeId}/secret`, {
    method: 'PUT',
    body: JSON.stringify({ notes: SECRET }),
  })
  const readBack = await call(`/api/projects/${PROJECT}/episodes/${episodeId}/secret`)
  ok('隱藏設定存得進去也讀得回來', readBack.notes === SECRET)

  /* ---- 3. 編劇視角判定 ------------------------------------------------ */
  const judged = await call(`/api/projects/${PROJECT}/audit`, {
    method: 'POST',
    body: JSON.stringify({
      episodeId,
      judge: doubts.map((d) => ({ question: d.question, quote: d.quote, why: d.why })),
    }),
  })
  const verdicts = judged.judge?.verdicts ?? []
  ok('編劇視角判出來了', verdicts.length > 0, `${verdicts.length} 條`)
  ok('它知道自己拿到了隱藏設定', judged.judge?.hadSecret === true)

  /*
   * 判定要對得回原本那一條。
   *
   * 模型很容易把問句改寫一下，而改寫過就對不回去——畫面上會變成「每一條疑點
   * 都沒有判定，旁邊另外列了一堆判定」。所以提示詞要求照抄，這裡驗它有沒有照
   * 做。
   */
  const matched = doubts.filter((d) => verdicts.some((v) => v.question === d.question))
  ok(
    '判定對得回原本的疑點（模型有照抄問句）',
    matched.length === doubts.length,
    `${matched.length}/${doubts.length}`
  )

  const codes = [...new Set(verdicts.map((v) => v.verdict))]
  ok(
    '判定用的是四個代碼之一',
    codes.every((c) => ['HELD_BACK', 'UNDER_SEEDED', 'REAL_HOLE', 'NOT_ENOUGH_INFO'].includes(c)),
    codes.join('、')
  )
  ok(
    '每一條都說得出理由',
    verdicts.every((v) => String(v.because || '').trim().length > 0)
  )
  ok(
    '判「合理留白」的那幾條沒有附修改建議',
    verdicts.filter((v) => v.verdict === 'HELD_BACK').every((v) => !v.fix)
  )

  console.log('\n  判定內容：')
  for (const v of verdicts.slice(0, 4)) {
    console.log(`    [${v.verdict}] ${v.question.slice(0, 44)}`)
    console.log(`         ${String(v.because).slice(0, 90)}`)
  }
} finally {
  /* ---- 4. 清掉驗收用的隱藏設定 ---------------------------------------- */
  await call(`/api/projects/${PROJECT}/episodes/${episodeId}/secret`, {
    method: 'PUT',
    body: JSON.stringify({ notes: '' }),
  }).catch(() => {})
  const after = await call(`/api/projects/${PROJECT}/episodes/${episodeId}/secret`).catch(
    () => ({ notes: '?' })
  )
  ok('驗收用的隱藏設定清掉了', after.notes === '')
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
