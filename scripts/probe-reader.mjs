/**
 * 換章之後有沒有回到開頭 (Z134).
 *
 * 量法：捲到一半、按下一章、再量捲動位置。class 看不出這件事。
 */
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
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-read-${Date.now()}`))

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
  await client.send('Page.navigate', { url: `${base}/read/${projectId}` }, sessionId)
  await loaded
  await new Promise((r) => setTimeout(r, 1800))

  const report = await ev(`JSON.stringify((() => {
    // 正文欄是頁面上捲得最多的那個容器。
    const columns = [...document.querySelectorAll('div')]
      .filter((n) => n.scrollHeight > n.clientHeight + 50)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)
    const column = columns[0]
    if (!column) return { error: '找不到會捲的正文欄' }

    column.scrollTop = 600
    const before = column.scrollTop

    const next = [...document.querySelectorAll('button')]
      .find((b) => /下一章|下一頁/.test(b.innerText || b.getAttribute('aria-label') || ''))
    if (!next) return { error: '找不到下一章按鈕', before }
    next.click()
    return { before, clicked: true }
  })())`)

  const first = JSON.parse(report)
  if (first.error) { console.log('  ', first.error); }
  else {
    await new Promise((r) => setTimeout(r, 700))
    const after = await ev(`(() => {
      const columns = [...document.querySelectorAll('div')]
        .filter((n) => n.scrollHeight > n.clientHeight + 50)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)
      return columns[0] ? columns[0].scrollTop : -1
    })()`)
    console.log(`  換章前捲到 ${first.before}px → 換章後 ${after}px`)
    console.log(`  ${after === 0 ? '✓ 回到開頭了' : '✗ 還停在中間'}`)
  }
} finally { chrome.kill() }
