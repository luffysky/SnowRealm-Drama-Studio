import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const base = 'http://127.0.0.1:3400'
// Leading slash optional: Git Bash on Windows rewrites '/listen' into a
// Windows path before Node ever sees it (same note as shots.mjs).
const raw = process.argv[2] ?? 'listen'
const path = raw.startsWith('/') ? raw : '/' + raw.replace(/^.*[\/]/, '')
const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-of-${Date.now()}`))

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
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId)

  const loaded = client.once('Page.loadEventFired')
  await client.send('Page.navigate', { url: base + path }, sessionId)
  await loaded
  await new Promise((r) => setTimeout(r, 1500))

  const { result } = await client.send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const limit = document.documentElement.clientWidth
      const out = []
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.right > limit + 0.5 && r.width > 0) {
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 110),
            right: Math.round(r.right),
            width: Math.round(r.width),
            text: (el.innerText || '').slice(0, 30).replace(/\s+/g, ' '),
          })
        }
      }
      return { limit, count: out.length, worst: out.slice(0, 12) }
    })())`,
    returnByValue: true,
  }, sessionId)

  const parsed = JSON.parse(result.value)
  console.log(`視窗寬 ${parsed.limit}，超出的元素 ${parsed.count} 個`)
  for (const row of parsed.worst) {
    console.log(`  <${row.tag}> right=${row.right} w=${row.width} "${row.text}"`)
    console.log(`      ${row.cls}`)
  }
} finally {
  chrome.kill()
}
