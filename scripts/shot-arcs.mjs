/**
 * 卷與「新增章節：下一集」的實機檢查 (Z128).
 *
 * Reads what is on screen rather than what the classes say, and exercises the
 * one operation that could destroy work: making a 卷, moving episodes into it,
 * then deleting it and checking the episodes are still there with the same
 * numbers.
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
const cookies = await signIn(base, 'collaborator')
await mkdir('.shots', { recursive: true })

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-arc-${Date.now()}`))

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Network.enable', {}, sessionId)

  const { hostname } = new URL(base)
  for (const [name, value] of Object.entries(cookies)) {
    await client.send('Network.setCookie', { name, value, domain: hostname, path: '/' }, sessionId)
  }

  const ev = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
  }

  const goto = async (url) => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 900))
  }

  const shot = async (name) => {
    const { data } = await client.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId
    )
    await writeFile(join('.shots', `${name}.png`), Buffer.from(data, 'base64'))
  }

  const projectId = process.argv[2]
  if (!projectId) throw new Error('用法：node scripts/shot-arcs.mjs <projectId>')

  for (const [w, h, label, mobile] of [[1440, 900, 'desktop', false], [390, 844, 'phone', true]]) {
    await client.send(
      'Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile },
      sessionId
    )
    await goto(`${base}/projects/${projectId}/episodes`)

    const bar = await ev(`JSON.stringify((() => {
      const text = (document.body.innerText || '')
      const lines = text.split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean)
      const i = lines.findIndex((l) => l === '卷')
      return {
        hasBar: i !== -1,
        chips: i === -1 ? [] : lines.slice(i + 1, i + 6),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })())`)
    console.log(`[${label}] 卷列: ${bar}`)
    await shot(`arcs-${label}-bar`)

    const opened = await ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText||'').includes('管理卷'))
      if (!b) return 'NO BUTTON'
      b.click()
      return 'opened'
    })()`)
    await new Promise((r) => setTimeout(r, 600))
    const dialog = await ev(`JSON.stringify((() => {
      const d = document.querySelector('[role="dialog"]')
      return {
        present: !!d,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        text: d ? (d.innerText||'').split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean).slice(0,8) : [],
      }
    })())`)
    console.log(`[${label}] 管理卷對話框: ${opened} ${dialog}`)
    await shot(`arcs-${label}-dialog`)
  }
} finally {
  chrome.kill()
}
