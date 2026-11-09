/**
 * 編劇助手：按下去、等它跑完、量字級（Z198）。
 *
 *     npm run dev          # 另一個終端機
 *     node scripts/probe-writer.mjs <projectId> <輸出的 png>
 *
 * **會真的花錢**（一次摘要大約 US$0.16），所以不在提交門檻上。
 *
 * 寫這一支的理由是「產出的字太小」這條回報——而那種事截圖看不準，要量
 * `getComputedStyle`。順便守住兩件事：那個請求真的有回來（它要跑七十幾秒，比
 * 任何預設逾時都長），以及報告真的被畫出來。
 *
 * ## 偵測不要掃整頁文字
 *
 * 第一版用 `/目前的主線/` 掃 `document.body.innerText`，而頁面上方那四個問題裡
 * 就有「目前的主線與人設」——於是它在第一圈就命中，在模型還在跑的第七秒截圖，
 * 然後我花了兩次呼叫在查一個不存在的「卡住」。要等的是真的被畫出來的那個
 * `h3`。
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

const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-w-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Network.enable', {}, sessionId)
  await client.send('Runtime.enable', {}, sessionId)
  const { hostname } = new URL(base)
  for (const [n, v] of Object.entries(cookies)) {
    await client.send('Network.setCookie', { name: n, value: v, domain: hostname, path: '/' }, sessionId)
  }

  const started = Date.now()
  const tick = () => `${((Date.now() - started) / 1000).toFixed(1)}s`
  client.on('Network.requestWillBeSent', (e) => {
    if (/\/audit/.test(e.request.url)) console.log(`  ${tick()} 送出 ${e.request.method} ${e.request.url}`)
  })
  client.on('Network.responseReceived', (e) => {
    if (/\/audit/.test(e.response.url)) console.log(`  ${tick()} 回來 ${e.response.status}`)
  })
  client.on('Network.loadingFailed', (e) => {
    console.log(`  ${tick()} 失敗 ${e.errorText}${e.canceled ? '（取消）' : ''}`)
  })
  client.on('Runtime.exceptionThrown', (e) => {
    console.log(`  ${tick()} 例外 ${String(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text).slice(0, 200)}`)
  })
  client.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error') {
      console.log(`  ${tick()} console ${e.args.map((a) => String(a.value ?? a.description ?? '')).join(' ').slice(0, 200)}`)
    }
  })

  const ev = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId
  )
  const loaded = client.once('Page.loadEventFired')
  await client.send('Page.navigate', { url: `${base}/projects/${PROJECT}/writer` }, sessionId)
  await loaded
  await wait(3000)

  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /主線與人設|主线与人设/.test(x.innerText || ''))
    b.click()
  })()`)

  for (let i = 0; i < 100; i += 1) {
    await wait(2000)
    // 頁面上方那四個問題裡就有「目前的主線與人設」，掃整頁文字會在第一圈就
    // 誤判。要等的是真的被畫出來的那個 h3。
    const has = await ev(`[...document.querySelectorAll('h3')].some((h) => /目前的主線|目前的主线/.test(h.innerText || ''))`)
    if (has) {
      console.log(`  ${tick()} 畫面上出現主線`)
      break
    }
  }

  const sizes = await ev(`JSON.stringify((() => {
    const head = [...document.querySelectorAll('h3')].find((h) => /主線|主线/.test(h.innerText || ''))
    const body = head ? head.parentElement.querySelector('p') : null
    const quote = [...document.querySelectorAll('p')].find((p) => /border-l-2/.test(p.className))
    return {
      主線本文: body ? getComputedStyle(body).fontSize + ' / 行高 ' + getComputedStyle(body).lineHeight : null,
      區塊標題: head ? getComputedStyle(head).fontSize : null,
      引文: quote ? getComputedStyle(quote).fontSize : null,
    }
  })())`)
  console.log('量到的字級：', sizes)

  const { data } = await client.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    sessionId
  )
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('截圖：', OUT)
} finally {
  chrome.kill()
}
