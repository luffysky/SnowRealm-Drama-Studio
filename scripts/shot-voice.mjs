/**
 * 截兩個要點開才看得到的畫面 (Z140).
 *
 * `shots.mjs` 只會導航，而這兩個都在互動後面：角色頁的配音分頁要先點一個
 * 角色再點分頁，浮動播放器要先按下播放。靜態截圖拍不到，所以這支自己點。
 *
 *   node scripts/shot-voice.mjs --base http://127.0.0.1:3401
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

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const base = (arg('base', 'http://127.0.0.1:3401') ?? '').replace(/\/$/, '')
const out = arg('out', '.shots')
const project = '935dc410-79dc-48df-8834-887e9dc59597'

await mkdir(out, { recursive: true })

// 一律用協作者帳號登入。擁有者那個是暖寶的。
const cookies = await signIn(base, 'collaborator')

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-voice-${Date.now()}`))

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Runtime.enable', {}, sessionId)

  const { hostname } = new URL(base)
  for (const [name, value] of Object.entries(cookies)) {
    await client.send('Network.setCookie', { name, value, domain: hostname, path: '/' }, sessionId)
  }

  const viewport = async (width, height) =>
    client.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId
    )

  const go = async (path) => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: base + path }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1400))
  }

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed')
    return result.value
  }

  /** 按文字找一個可以點的東西並點它。回報點到什麼，或點不到。 */
  const clickText = async (text, tag = '*') => {
    const clicked = await evaluate(`(() => {
      const wanted = ${JSON.stringify(text)}
      const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})]
      const hit = nodes.find((node) => {
        if (node.offsetParent === null) return false
        const own = [...node.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join('')
        return own.includes(wanted) || node.textContent?.trim() === wanted
      })
      if (!hit) return null
      hit.click()
      return hit.tagName + ' ' + (hit.textContent ?? '').trim().slice(0, 30)
    })()`)
    if (!clicked) throw new Error(`點不到「${text}」`)
    await new Promise((r) => setTimeout(r, 1200))
    return clicked
  }

  const shoot = async (name) => {
    const { data } = await client.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId
    )
    const file = join(out, `${name}.png`)
    await writeFile(file, Buffer.from(data, 'base64'))
    console.log(`  寫出 ${file}`)
  }

  /* ---------------------------------------------- 角色頁的音色選擇器 */

  await viewport(1440, 900)
  await go(`/projects/${project}/characters`)
  console.log(`  點到 ${await clickText('沈知味', 'button')}`)
  console.log(`  點到 ${await clickText('配音', 'button')}`)
  // 等音色清單從 Azure 回來。
  await new Promise((r) => setTimeout(r, 2500))
  await shoot('voice-picker-desktop')

  const summary = await evaluate(`(() => {
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value.startsWith('zh-'))
    )
    if (!select) return { found: false }
    return {
      found: true,
      options: select.options.length,
      groups: [...select.querySelectorAll('optgroup')].map((g) => g.label),
      chosen: select.value,
      chosenLabel: select.selectedOptions[0]?.textContent?.trim() ?? '',
      note: document.body.innerText.match(/破音字[^\\n]*/)?.[0] ?? '',
      styleHint: document.body.innerText.match(/預設情緒風格[\\s\\S]{0,80}/)?.[0]?.replace(/\\n/g, ' ') ?? '',
    }
  })()`)
  console.log('  音色選單：', JSON.stringify(summary, null, 2))

  await viewport(390, 844)
  await new Promise((r) => setTimeout(r, 900))
  await shoot('voice-picker-phone')

  /* -------------------------------------------------- 浮動播放器的波形 */

  await viewport(1440, 900)
  // 播放器在 /listen，不是素材頁——素材頁用的是自己那支 WaveformPlayer。
  await go('/listen')

  const played = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.offsetParent !== null && /^(播放|播放中|暫停)$/.test(b.getAttribute('aria-label') ?? '')
    )
    if (!button) {
      return {
        clicked: null,
        labels: [...document.querySelectorAll('button[aria-label]')]
          .map((b) => b.getAttribute('aria-label'))
          .slice(0, 20),
      }
    }
    button.click()
    return { clicked: button.getAttribute('aria-label') }
  })()`)
  console.log(`  播放鈕：${JSON.stringify(played)}`)
  await new Promise((r) => setTimeout(r, 3500))
  await shoot('player-waveform-desktop')

  const canvas = await evaluate(`(() => {
    const found = [...document.querySelectorAll('canvas')].map((c) => ({
      width: c.clientWidth,
      height: c.clientHeight,
      drawn: (() => {
        try {
          const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
          let lit = 0
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit += 1
          return lit
        } catch { return -1 }
      })(),
    }))
    return { canvases: found, player: Boolean(document.querySelector('#music-seek')) }
  })()`)
  console.log('  canvas：', JSON.stringify(canvas))

  await viewport(390, 844)
  await new Promise((r) => setTimeout(r, 900))
  await shoot('player-waveform-phone')
} finally {
  chrome.kill()
}
