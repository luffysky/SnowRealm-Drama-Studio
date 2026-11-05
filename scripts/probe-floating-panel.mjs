import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

/**
 * 懸浮球的對話框有沒有超出視口 (Z158).
 *
 * 這個 bug 用看截圖抓不到，因為**跑到畫面外的那一塊根本不會被畫出來**——截圖
 * 看起來只是「面板比較矮」。要抓它只有一個辦法：量 `getBoundingClientRect()`
 * 的四個邊，跟視口比。
 *
 * 量的是 `/assistant`：那一頁有自己的輸入列，會把 `--dock-height` 設成一個
 * 真實的高度，而那正是把面板頂出畫面的東西。再把視窗調矮，模擬手機橫放或
 * 小筆電。
 */

const BASE = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:3400')
  .replace(/\/$/, '')

/** 視窗尺寸，由寬到窄、由高到矮。最後兩組是會出事的那幾組。 */
const SIZES = [
  { name: '桌機 1440x900', width: 1440, height: 900 },
  { name: '筆電 1280x720', width: 1280, height: 720 },
  { name: '手機直放 390x844', width: 390, height: 844, mobile: true },
  { name: '手機橫放 844x390', width: 844, height: 390, mobile: true },
  { name: '很矮的視窗 1280x420', width: 1280, height: 420 },
]

function env() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

async function main() {
  env()

  const cookies = await signIn(BASE, 'collaborator')
  console.log('  已登入（collaborator）\n')

  const port = 9222 + Math.floor(Math.random() * 500)
  const chrome = launchChrome(port, join(tmpdir(), `srds-panel-${Date.now()}`))

  let failures = 0

  try {
    const client = await Cdp.connect(await debuggerUrl(port))
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })

    await client.send('Page.enable', {}, sessionId)
    await client.send('Network.enable', {}, sessionId)

    const { hostname } = new URL(BASE)
    for (const [name, value] of Object.entries(cookies)) {
      await client.send('Network.setCookie', { name, value, domain: hostname, path: '/' }, sessionId)
    }

    for (const size of SIZES) {
      await client.send(
        'Emulation.setDeviceMetricsOverride',
        {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 1,
          mobile: Boolean(size.mobile),
        },
        sessionId
      )

      const loaded = client.once('Page.loadEventFired')
      await client.send('Page.navigate', { url: `${BASE}/assistant` }, sessionId)
      await loaded
      await new Promise((r) => setTimeout(r, 1200))

      /*
       * 開面板：點那顆球。它的 aria-label 會因為未讀數變化，所以用前綴比對。
       * 面板本身是 `role="dialog" aria-label="對話"`。
       */
      const measure = `
        (() => {
          const ball = [...document.querySelectorAll('button[aria-label]')]
            .find((b) => b.getAttribute('aria-label').startsWith('對話'))
          if (ball) ball.click()
          return new Promise((resolve) => setTimeout(() => {
            const panel = document.querySelector('[role="dialog"][aria-label="對話"]')
            if (!panel) return resolve({ found: false })

            // 把面板撐到最高再量：空的對話只有兩百多像素高，永遠碰不到上限，
            // 量它只會得到「沒事」——而這個 bug 正是高度上限算錯。
            // （這一段字串裡不能出現反引號，它整個包在樣板字串裡。）
            const filler = document.createElement('div')
            filler.style.height = '4000px'
            filler.dataset.probeFiller = '1'
            panel.appendChild(filler)

            const r = panel.getBoundingClientRect()
            const root = getComputedStyle(document.documentElement)
            resolve({
              found: true,
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              left: Math.round(r.left),
              right: Math.round(r.right),
              vw: window.innerWidth,
              vh: window.innerHeight,
              dock: root.getPropertyValue('--dock-height').trim() || '0px',
            })
          }, 500))
        })()
      `

      const { result } = await client.send(
        'Runtime.evaluate',
        { expression: measure, awaitPromise: true, returnByValue: true },
        sessionId
      )

      const box = result.value
      if (!box?.found) {
        console.log(`  ${size.name.padEnd(20)} 找不到對話框（可能這一頁不顯示懸浮球）`)
        continue
      }

      const over = []
      if (box.top < 0) over.push(`上緣超出 ${-box.top}px`)
      if (box.left < 0) over.push(`左緣超出 ${-box.left}px`)
      if (box.bottom > box.vh) over.push(`下緣超出 ${box.bottom - box.vh}px`)
      if (box.right > box.vw) over.push(`右緣超出 ${box.right - box.vw}px`)

      const ok = over.length === 0
      if (!ok) failures += 1

      console.log(
        `  ${ok ? '✓' : '✗'} ${size.name.padEnd(20)} ` +
          `視口 ${box.vw}x${box.vh}　工具列 ${box.dock}　` +
          `面板 top=${box.top} bottom=${box.bottom} left=${box.left} right=${box.right}` +
          (ok ? '' : `\n      ${over.join('、')}`)
      )
    }
  } finally {
    chrome.kill()
  }

  if (failures > 0) {
    console.log(`\n  ✗ ${failures} 種尺寸底下對話框跑出視口`)
    process.exitCode = 1
  } else {
    console.log('\n  ✓ 每一種尺寸對話框都在視口裡')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
