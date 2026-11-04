/**
 * Walks every tab of AI 製片中心 and reports what each one actually rendered.
 *
 * A screenshot run for a page of statistics is not about whether the layout
 * is pretty — it is about whether each tab has content at all, and whether
 * anything overflows the viewport on a phone. Both are things class names
 * cannot tell you.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

const PANELS = ['待確認', '體檢', '批次生成', '花費', '產能', '佇列']
const VIEWS = [
  { name: 'phone', width: 390, height: 844, scale: 2, mobile: true },
  { name: 'desktop', width: 1440, height: 900, scale: 1, mobile: false },
]

const base = 'http://127.0.0.1:3400'
const outDir = '.shots'

const { readFileSync } = await import('node:fs')
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}

const cookies = await signIn(base, 'collaborator')
await mkdir(outDir, { recursive: true })

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-ai-${Date.now()}`))

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

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    // Silence here is how a probe reports a healthy page it never reached.
    if (exceptionDetails) {
      throw new Error(
        `頁面內的程式丟錯：${exceptionDetails.exception?.description ?? exceptionDetails.text}`
      )
    }
    return result.value
  }

  for (const view of VIEWS) {
    await client.send(
      'Emulation.setDeviceMetricsOverride',
      { width: view.width, height: view.height, deviceScaleFactor: view.scale, mobile: view.mobile },
      sessionId
    )

    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}/ai` }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 900))

    for (const panel of PANELS) {
      const clicked = await evaluate(`(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')]
          .find((t) => (t.innerText || '').includes(${JSON.stringify(panel)}))
        if (!tab) return 'NO TAB'
        tab.click()
        return 'clicked'
      })()`)
      await new Promise((r) => setTimeout(r, 500))

      const report = await evaluate(`JSON.stringify((() => {
        const main = document.querySelector('main') || document.body
        const text = (main.innerText || '').trim()
        const lines = text.split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean)
        return {
          chars: text.length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          lines: lines.slice(0, 5),
        }
      })())`)

      const parsed = JSON.parse(report)
      const flag = parsed.overflow > 0 ? `  !! 橫向溢出 ${parsed.overflow}px` : ''
      console.log(
        `[${view.name}] ${panel}: ${clicked} ${parsed.chars} 字${flag}\n    ${parsed.lines.join(' | ')}`
      )

      const { data } = await client.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true },
        sessionId
      )
      await writeFile(
        join(outDir, `ai-${view.name}-${PANELS.indexOf(panel)}-${panel}.png`),
        Buffer.from(data, 'base64')
      )
    }
  }
} finally {
  chrome.kill()
}
