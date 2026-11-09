/**
 * 存起來的整理，走完一整圈（Z200 驗收）。
 *
 *     npm run dev          # 另一個終端機
 *     node scripts/probe-writer-save.mjs <projectId> <輸出的 png>
 *
 * **會真的花錢**（跑一次主線整理大約 US$0.16），而且**會寫進資料庫**——所以它
 * 最後一步會把自己存的那一份刪掉，不要在正式庫留驗收資料。
 *
 * 走的路：打開頁面 → 整理主線 → 按「存起來」→ **重新整理** → 確認它還在而且
 * 是收合的 → 點箭頭展開 → 刪掉 → 確認那一區不見了。
 *
 * 重新整理那一步是重點：存進資料庫跟存在 React state 裡，在按下去的當下長得
 * 一模一樣。
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const base = 'http://127.0.0.1:3400'
const PROJECT = process.argv[2]
const OUT = process.argv[3]

let pass = 0
let fail = 0
const ok = (label, good, detail = '') => {
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
  if (good) pass += 1
  else fail += 1
}

const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-save-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const ev = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  const go = async () => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}/projects/${PROJECT}/writer` }, sessionId)
    await loaded
    await wait(3000)
  }

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId
  )
  await go()
  ok('編劇助手頁打得開（表建好了）', (await ev(`!/500|Internal/.test(document.body.innerText||'')`)) === true)

  // 1) 跑一份主線整理
  await ev(`[...document.querySelectorAll('button')].find((x) => /主線與人設|主线与人设/.test(x.innerText||'')).click()`)
  for (let i = 0; i < 100; i += 1) {
    await wait(2000)
    const done = await ev(`[...document.querySelectorAll('h3')].some((h) => /目前的主線|目前的主线/.test(h.innerText||''))`)
    if (done) break
  }
  ok('整理出來了', (await ev(`[...document.querySelectorAll('h3')].some((h) => /目前的主線|目前的主线/.test(h.innerText||''))`)) === true)

  // 2) 按「存起來」
  const saved = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^存起來$|^存起来$/.test((x.innerText||'').trim()))
    if (!b) return 'no button'
    b.click()
    return 'clicked'
  })()`)
  ok('找得到「存起來」並按下去', saved === 'clicked', String(saved))
  await wait(3500)

  // 3) 重新整理，看它還在不在
  await go()
  const list = await ev(`JSON.stringify((() => {
    const head = [...document.querySelectorAll('h2')].find((h) => /存起來的|存起来的/.test(h.innerText||''))
    if (!head) return { found: false }
    const section = head.closest('section')
    const items = [...section.querySelectorAll('details')]
    return {
      found: true,
      count: items.length,
      first: items[0] ? (items[0].querySelector('summary').innerText||'').replace(/\\s+/g,' ').trim() : null,
      open: items[0] ? items[0].open : null,
    }
  })())`)
  const info = JSON.parse(list)
  ok('重新整理之後「存起來的」裡有那一份', info.found && info.count > 0, list)
  ok('預設是收合的', info.open === false)

  // 4) 點箭頭展開
  await ev(`(() => {
    const head = [...document.querySelectorAll('h2')].find((h) => /存起來的|存起来的/.test(h.innerText||''))
    head.closest('section').querySelector('details > summary').click()
  })()`)
  await wait(600)
  const opened = await ev(`(() => {
    const head = [...document.querySelectorAll('h2')].find((h) => /存起來的|存起来的/.test(h.innerText||''))
    const d = head.closest('section').querySelector('details')
    return d.open && /目前的主線|目前的主线/.test(d.innerText||'')
  })()`)
  ok('點箭頭展得開，而且裡面是整理的內容', opened === true)

  const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('  截圖：', OUT)

  // 5) 刪掉——不要在正式庫留下驗收用的資料
  await ev(`(() => {
    const head = [...document.querySelectorAll('h2')].find((h) => /存起來的|存起来的/.test(h.innerText||''))
    const d = head.closest('section').querySelector('details')
    const b = [...d.querySelectorAll('button')].find((x) => /刪掉|删掉/.test(x.innerText||''))
    b.click()
  })()`)
  await wait(400)
  await ev(`(() => {
    const head = [...document.querySelectorAll('h2')].find((h) => /存起來的|存起来的/.test(h.innerText||''))
    const d = head.closest('section').querySelector('details')
    const b = [...d.querySelectorAll('button')].find((x) => /^刪掉$|^删掉$/.test((x.innerText||'').trim()))
    b.click()
  })()`)
  await wait(3000)
  await go()
  const after = await ev(`[...document.querySelectorAll('h2')].some((h) => /存起來的|存起来的/.test(h.innerText||''))`)
  ok('刪掉之後那一區就不見了（正式庫沒留驗收資料）', after === false)
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
