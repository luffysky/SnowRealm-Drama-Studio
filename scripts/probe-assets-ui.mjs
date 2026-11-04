/** 素材刪除鍵與總覽分類卡片連結 (Z138). */
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
const chrome = launchChrome(port, join(tmpdir(), `srds-assets-${Date.now()}`))

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
  const goto = async (path) => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: base + path }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1400))
  }

  await goto(`/projects/${projectId}/assets`)
  const cards = await ev(`JSON.stringify((() => {
    const links = [...document.querySelectorAll('a[href*="/assets/"]')]
      .filter((a) => !a.getAttribute('href').includes('/episodes/'))
    return { count: links.length, hrefs: [...new Set(links.map((a) => a.getAttribute('href')))].slice(0, 10) }
  })())`)
  console.log('  [總覽] 分類卡片連結：', cards)

  await goto(`/projects/${projectId}/assets/voice`)
  const del = await ev(`JSON.stringify((() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => /^[刪删]除$/.test((b.innerText || '').trim()))
    return { deleteButtons: buttons.length, rows: document.querySelectorAll('article').length }
  })())`)
  console.log('  [配音分頁] ', del)

  // 開一次確認框，確認它問的是對的事
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^[刪删]除$/.test((x.innerText || '').trim()))
    if (b) b.click()
    return !!b
  })()`)
  await new Promise((r) => setTimeout(r, 600))
  const dialog = await ev(`JSON.stringify((() => {
    const d = document.querySelector('[role="dialog"]')
    return d ? (d.innerText || '').split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean).slice(0, 6) : null
  })())`)
  console.log('  [確認框] ', dialog)
} finally { chrome.kill() }
