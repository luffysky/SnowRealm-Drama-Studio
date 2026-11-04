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
const chrome = launchChrome(port, join(tmpdir(), `srds-chap-${Date.now()}`))

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

  const ev = async (e) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId)
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  const [projectId, episodeId] = process.argv.slice(2)

  for (const [w, h, label, mobile] of [[1440, 900, 'desktop', false], [390, 844, 'phone', true]]) {
    await client.send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId)
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate',
      { url: `${base}/projects/${projectId}/episodes/${episodeId}/novel` }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1200))

    const report = await ev(`JSON.stringify((() => {
      const buttons = [...document.querySelectorAll('button')]
        .map((b) => (b.innerText || '').trim())
        .filter(Boolean)
      const next = [...document.querySelectorAll('button')]
        .find((b) => (b.innerText||'').trim() === '下一集')
      return {
        hasAdd: buttons.some((t) => t.includes('新增章節')),
        hasNext: !!next,
        nextTitle: next ? next.getAttribute('title') : null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })())`)
    console.log(`[${label}] ${report}`)

    const { data } = await client.send('Page.captureScreenshot',
      { format: 'png', clip: { x: 0, y: 0, width: Math.min(w, 420), height: 260, scale: 1 } }, sessionId)
    await writeFile(join('.shots', `chapter-${label}.png`), Buffer.from(data, 'base64'))
  }
} finally {
  chrome.kill()
}
