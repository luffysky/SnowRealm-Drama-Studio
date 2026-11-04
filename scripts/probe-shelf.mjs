/** 書架上實際畫出幾本 (Z137). */
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
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-shelf-${Date.now()}`))

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
  await client.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)

  const ev = async (e) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId)
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  const loaded = client.once('Page.loadEventFired')
  await client.send('Page.navigate', { url: `${base}/read` }, sessionId)
  await loaded
  await new Promise((r) => setTimeout(r, 1500))

  const report = await ev(`JSON.stringify((() => {
    const cards = [...document.querySelectorAll('a[href^="/read/"]')]
    return {
      cards: cards.length,
      titles: cards.map((a) => (a.innerText || '').split(String.fromCharCode(10))[0]),
      hrefs: cards.map((a) => a.getAttribute('href')),
      header: (document.querySelector('header') || {}).innerText || '',
    }
  })())`)
  console.log('  ', report)

  const { data } = await client.send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true }, sessionId)
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir('.shots', { recursive: true })
  await writeFile(join('.shots', 'shelf.png'), Buffer.from(data, 'base64'))
} finally { chrome.kill() }
