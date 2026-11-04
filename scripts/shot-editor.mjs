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
const cookies = await signIn(base, 'collaborator')
await mkdir('.shots', { recursive: true })
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-ed-${Date.now()}`))

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

  for (const [w, h, label, mobile] of [[1440, 900, 'desktop', false], [390, 844, 'phone', true]]) {
    await client.send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId)
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}/listen` }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1400))

    // 開編輯器
    await ev(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /貼上或上傳歌詞|編輯/.test(x.innerText || ''))
      if (b) b.click()
      return !!b
    })()`)
    await new Promise((r) => setTimeout(r, 600))

    // 貼 LRC 進 textarea（只在前端，不存）
    await ev(`(() => {
      const ta = document.querySelector('[role="dialog"] textarea')
      if (!ta) return 'no textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      const NL = String.fromCharCode(10)
      setter.call(ta, ['[00:02.00]測試第一句', '[00:06.00]測試第二句', '沒有時間碼的一句'].join(NL))
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`)
    await new Promise((r) => setTimeout(r, 300))

    // 切到打時間
    await ev(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')]
        .find((x) => (x.innerText || '').startsWith('打時間'))
      if (b) b.click()
      return !!b
    })()`)
    await new Promise((r) => setTimeout(r, 500))

    const report = await ev(`JSON.stringify((() => {
      const d = document.querySelector('[role="dialog"]')
      const text = d ? (d.innerText || '') : ''
      return {
        open: !!d,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lines: text.split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean).slice(0, 12),
      }
    })())`)
    console.log(`  [${label}] ${report}`)

    const { data } = await client.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true }, sessionId)
    await writeFile(join('.shots', `lyrics-editor-${label}.png`), Buffer.from(data, 'base64'))
  }
} finally { chrome.kill() }
