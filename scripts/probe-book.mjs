/**
 * 書籍頁的三個分頁 (Z136).
 *
 * 量的是「每個分頁有沒有真的長出內容」以及有沒有橫向溢出——class 名稱看不出
 * 這兩件事。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const base = 'http://127.0.0.1:3400'
const projectId = process.argv[2]
const cookies = await signIn(base, 'collaborator')
await mkdir('.shots', { recursive: true })
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-book-${Date.now()}`))

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

  const ev = async (e) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId)
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    await client.send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }, sessionId)

    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}/read/${projectId}` }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1500))

    for (const tab of ['目录', '简介', '有声']) {
      const clicked = await ev(`(() => {
        const t = [...document.querySelectorAll('[role="tab"]')]
          .find((x) => (x.innerText || '').includes(${JSON.stringify(tab)}))
        if (!t) return 'NO TAB'
        t.click()
        return 'ok'
      })()`)
      await new Promise((r) => setTimeout(r, 600))

      const report = await ev(`JSON.stringify((() => {
        const main = document.querySelector('main') || document.body
        const text = (main.innerText || '').trim()
        const lines = text.split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean)
        return {
          chars: text.length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          sample: lines.slice(4, 9),
        }
      })())`)
      const r = JSON.parse(report)
      console.log(`  [${label}] ${tab}: ${clicked} ${r.chars} 字${r.overflow > 0 ? `  !! 溢出 ${r.overflow}px` : ''}`)
      console.log(`      ${r.sample.join(' | ')}`)

      const { data } = await client.send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true }, sessionId)
      await writeFile(join('.shots', `book-${label}-${tab}.png`), Buffer.from(data, 'base64'))
    }
  }
} finally { chrome.kill() }
