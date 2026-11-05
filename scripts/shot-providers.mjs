/**
 * 截 AI 製片中心的供應商區塊 (Z146).
 *
 * 要點兩下才看得到：供應商在「任務佇列」那個分頁底下，而新增表單預設收著。
 * `shots.mjs` 只會導航，所以這支自己點。
 *
 *   node scripts/shot-providers.mjs --base http://127.0.0.1:3402
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

const base = (arg('base', 'http://127.0.0.1:3402') ?? '').replace(/\/$/, '')
const out = arg('out', '.shots')
await mkdir(out, { recursive: true })

// 一律用協作者帳號登入。擁有者那個是暖寶的。
const cookies = await signIn(base, 'collaborator')

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-prov-${Date.now()}`))

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
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId
  )

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed')
    return result.value
  }

  /*
   * 繁簡兩種都要試 (Z146).
   *
   * 介面預設顯示簡體（Z135），所以「佇列」在畫面上是「伫列」、「新增供應商」
   * 是「新增供应商」。第一版只找繁體，於是一個按鈕都點不到——**這是我自己
   * 的轉換功能第二次絆倒我自己的探測腳本**，上一次是找「刪除」而畫面寫
   * 「删除」。
   */
  const clickText = async (candidates) => {
    const hit = await evaluate(`(() => {
      const wanted = ${JSON.stringify(candidates)}
      const node = [...document.querySelectorAll('button')].find(
        (b) =>
          b.offsetParent !== null &&
          wanted.some((w) => (b.textContent ?? '').trim().includes(w))
      )
      if (!node) {
        return { clicked: null, seen: [...document.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => (b.textContent ?? '').trim().slice(0, 12))
          .slice(0, 16) }
      }
      node.click()
      return { clicked: (node.textContent ?? '').trim().slice(0, 24) }
    })()`)
    await new Promise((r) => setTimeout(r, 1000))
    return hit
  }

  const shoot = async (name) => {
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' }, sessionId)
    await writeFile(join(out, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`  寫出 ${join(out, `${name}.png`)}`)
  }

  const loaded = client.once('Page.loadEventFired')
  await client.send('Page.navigate', { url: `${base}/ai` }, sessionId)
  await loaded
  await new Promise((r) => setTimeout(r, 2000))

  // 供應商在「任務佇列」那個分頁底下。
  console.log(`  點分頁：${JSON.stringify(await clickText(['佇列', '伫列']))}`)
  console.log(`  點新增：${JSON.stringify(await clickText(['新增供應商', '新增供应商']))}`)
  await new Promise((r) => setTimeout(r, 800))

  await shoot('ai-providers-form')

  const found = await evaluate(`(() => {
    const text = document.body.innerText
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      options: [...s.options].map((o) => o.textContent?.trim()),
    }))
    return {
      hasForm: text.includes('API 金鑰'),
      kinds: selects.find((s) => s.options.some((o) => o?.includes('Claude')))?.options ?? [],
      models: selects.find((s) => s.options.some((o) => o?.startsWith('claude-')))?.options ?? [],
      keyNote: text.match(/金鑰加密存在伺服器[^\\n]*/)?.[0] ?? '',
      stars: (text.match(/\\*\\*/g) ?? []).length,
    }
  })()`)
  console.log('  表單內容：', JSON.stringify(found, null, 2))
} finally {
  chrome.kill()
}
