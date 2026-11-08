/**
 * 懸浮對話在不在，以及它的關閉鍵看不看得見（Z196）。
 *
 *     node scripts/probe-floating-chat.mjs      # 要先 npm run dev
 *
 * **唯讀**：只量 computed style，不點任何東西。
 *
 * 守的是兩個都不會有人發現的錯：
 *
 * 1. `restored.current` 那道守衛在 StrictMode 下會把自己鎖死（第一次掛載排
 *    timer、cleanup 取消它、第二次掛載被旗標擋下來），於是 `setReady(true)`
 *    永遠不跑，整個懸浮對話在**開發環境裡從來不出現**。正式站沒有雙重掛載所
 *    以看不出來——而「只有 dev 壞」的意思是本機沒有人驗得了這個元件的任何一
 *    行。
 * 2. 關閉鍵寫著 `group-hover:` 而檔案裡沒有任何 `.group` 祖先，所以 `sm` 以
 *    下它永遠 `opacity: 0`，但照樣佔 28×28 而且按得下去。誤觸就把懸浮對話永
 *    久關掉，而救援用的小圖示是同一顆隱形的按鈕。
 *
 * 兩個都是「畫面上什麼都沒發生」，所以截圖與型別檢查都看不出來。
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
const chrome = launchChrome(port, join(tmpdir(), `srds-fc-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let fail = 0
const ok = (label, good, detail = '') => {
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!good) fail += 1
}

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

  const ev = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  const json = async (e) => JSON.parse(await ev(`JSON.stringify(${e})`))

  for (const width of [390, 1440]) {
    await client.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height: 844, deviceScaleFactor: 1, mobile: width < 700 },
      sessionId
    )
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}/dashboard` }, sessionId)
    await loaded
    await wait(3500)

    const found = await json(`(() => {
      const button = [...document.querySelectorAll('button[aria-label]')]
        .find((b) => /關閉懸浮對話/.test(b.getAttribute('aria-label') || ''))
      if (!button) return { present: false }
      const style = getComputedStyle(button)
      const box = button.getBoundingClientRect()
      return {
        present: true,
        opacity: Number(style.opacity),
        size: [Math.round(box.width), Math.round(box.height)],
        inGroup: Boolean(button.closest('.group')),
      }
    })()`)

    ok(`${width}px：懸浮對話真的渲染出來了`, found.present === true, JSON.stringify(found))
    if (!found.present) continue
    ok(
      `${width}px：關閉鍵看得見（不是透明卻按得到）`,
      found.opacity > 0.2 && found.size[0] > 0,
      `opacity ${found.opacity}`
    )
    ok(`${width}px：它在一個 .group 裡，hover 規則才會命中`, found.inGroup === true)
  }
} finally {
  chrome.kill()
}

process.exit(fail > 0 ? 1 : 0)
