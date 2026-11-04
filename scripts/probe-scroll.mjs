/**
 * 側邊欄會不會跟著內容捲 (Z133).
 *
 * 量法：記下側邊欄在視窗裡的位置，把內容往下捲，再量一次。
 * 位置變了就代表它跟著跑。class 名稱看不出這件事，只有量得出來。
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
const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-scroll-${Date.now()}`))

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
    await client.send('Page.navigate', { url: `${base}/projects` }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1200))

    const report = await ev(`JSON.stringify((() => {
      const aside = document.querySelector('aside')
      const main = document.querySelector('main')
      if (!aside || !main) return { error: 'no aside/main' }

      const before = aside.getBoundingClientRect().top
      const scroller = main.scrollHeight > main.clientHeight ? main : document.scrollingElement
      scroller.scrollTop = 400
      const scrolled = scroller.scrollTop
      const after = aside.getBoundingClientRect().top

      return {
        scrolledBy: scrolled,
        asideMoved: Math.round(before - after),
        mainScrolls: main.scrollHeight > main.clientHeight,
        pageScrolls: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      }
    })())`)

    const r = JSON.parse(report)
    const verdict = r.error
      ? r.error
      : r.scrolledBy === 0
        ? '內容不夠長，捲不動（這一頁測不出來）'
        : r.asideMoved === 0
          ? '側邊欄沒動 ✓'
          : `側邊欄跟著跑了 ${r.asideMoved}px ✗`
    console.log(`  [${label}] 捲了 ${r.scrolledBy ?? 0}px → ${verdict}`)
    console.log(`           main 自己可捲：${r.mainScrolls}  整頁可捲：${r.pageScrolls}`)
  }
} finally { chrome.kill() }
