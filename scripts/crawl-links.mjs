/**
 * 真的把站台爬一遍，找出會跳 404 的連結 (Z139).
 *
 * 靜態檢查（`check-links.ts`）比對的是原始碼裡寫死的字串，但有一整類連結是
 * **執行期才拼出來的**：`hrefFor()` 從任務種類拼路徑、分類卡片從資料查分頁、
 * 清單從資料庫欄位組網址。上一個 404 就是這一類——靜態掃不到。
 *
 * 所以這支用真的瀏覽器登入、走過每一頁、把頁面上每一個站內連結收集起來，
 * 再一個一個請求回來看狀態碼。它看得到靜態看不到的，代價是要跑起伺服器。
 *
 * 不點按鈕、不開對話框——那些要互動才會出現的連結它看不到。兩支加起來才算
 * 一層防線，不是保證。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const base = 'http://127.0.0.1:3400'
const cookies = await signIn(base, 'collaborator')
const cookieHeader = Object.entries(cookies)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ')

/** The pages worth opening to harvest links. Real ids come from the data. */
const SEEDS = [
  '/dashboard',
  '/projects',
  '/read',
  '/watch',
  '/listen',
  '/messages',
  '/assistant',
  '/ai',
  '/settings',
  '/settings/profile',
]

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-crawl-${Date.now()}`))

const seen = new Set()
const found = new Map() // href → where it was seen

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Network.enable', {}, sessionId)

  const { hostname } = new URL(base)
  for (const [n, v] of Object.entries(cookies)) {
    await client.send('Network.setCookie', { name: n, value: v, domain: hostname, path: '/' }, sessionId)
  }
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId
  )

  const harvest = async (path) => {
    if (seen.has(path)) return []
    seen.add(path)

    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: base + path }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 900))

    const { result } = await client.send(
      'Runtime.evaluate',
      {
        expression: `[...document.querySelectorAll('a[href^="/"]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && !h.startsWith('//'))`,
        returnByValue: true,
      },
      sessionId
    )

    const hrefs = result.value ?? []
    for (const href of hrefs) {
      if (!found.has(href)) found.set(href, path)
    }
    return hrefs
  }

  // One hop out from the seeds: enough to reach every work, book and episode
  // page without walking 120 chapters.
  const queue = [...SEEDS]
  const depthOne = []

  for (const path of queue) {
    const hrefs = await harvest(path)
    depthOne.push(...hrefs)
  }

  for (const href of [...new Set(depthOne)].slice(0, 40)) {
    await harvest(href.split('#')[0])
  }

  console.log(`  走過 ${seen.size} 頁，收集到 ${found.size} 種站內連結`)
} finally {
  chrome.kill()
}

/* ---- now ask the server what each one actually returns ------------------ */

const broken = []
let checked = 0

for (const [href, from] of found) {
  const url = base + href
  try {
    const response = await fetch(url, {
      headers: { cookie: cookieHeader },
      redirect: 'manual',
    })
    checked += 1
    if (response.status === 404) broken.push({ href, from, status: 404 })
    else if (response.status >= 500) broken.push({ href, from, status: response.status })
  } catch (cause) {
    broken.push({ href, from, status: `連不上：${cause.message}` })
  }
}

console.log(`  請求過 ${checked} 個`)

if (broken.length === 0) {
  console.log('  ✓ 沒有連結會跳 404')
} else {
  console.log(`  ✗ ${broken.length} 個有問題：`)
  for (const row of broken) {
    console.log(`      ${row.status}  ${row.href}`)
    console.log(`            出現在 ${row.from}`)
  }
  process.exitCode = 1
}
