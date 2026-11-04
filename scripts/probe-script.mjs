/**
 * 繁簡轉換實測 (Z135).
 *
 * 四件事：第一次繪製有沒有轉、**之後新增的內容有沒有跟著轉**、輸入框的值
 * 有沒有被動到、小說正文有沒有照自己的設定走。
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
const chrome = launchChrome(port, join(tmpdir(), `srds-script-${Date.now()}`))

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
    await new Promise((r) => setTimeout(r, 1800))
  }

  // ---- 1. 第一次繪製 -----------------------------------------------------
  await goto('/projects')
  const first = await ev(`JSON.stringify((() => {
    const text = document.body.innerText
    return {
      繁體殘留: ['作品', '設定', '劇本', '進度'].filter((w) => text.includes(w)),
      簡體出現: ['作品', '设定', '剧本', '进度'].filter((w) => text.includes(w)),
    }
  })())`)
  console.log('  [1] 第一次繪製：', first)

  // ---- 2. 之後新增的內容 -------------------------------------------------
  const added = await ev(`JSON.stringify((() => {
    const probe = document.createElement('div')
    probe.id = 'srds-probe'
    probe.textContent = '這是後來才加進來的內容：設定與劇本'
    document.body.appendChild(probe)
    return { 加入時: probe.textContent }
  })())`)
  await new Promise((r) => setTimeout(r, 500))
  const afterAdd = await ev(`document.getElementById('srds-probe').textContent`)
  console.log('  [2] 動態新增：', JSON.parse(added).加入時, '→', afterAdd)
  console.log(`      ${afterAdd.includes('设定') && afterAdd.includes('剧本') ? '✓ 跟著轉了' : '✗ 沒有轉'}`)

  // ---- 3. 輸入框不能被動到 ----------------------------------------------
  const input = await ev(`JSON.stringify((() => {
    const el = document.createElement('input')
    el.id = 'srds-input'
    el.value = '這是輸入框裡的設定與劇本'
    document.body.appendChild(el)
    const ta = document.createElement('textarea')
    ta.id = 'srds-ta'
    ta.textContent = '這是編輯中的稿子：設定與劇本'
    document.body.appendChild(ta)
    return true
  })())`)
  void input
  await new Promise((r) => setTimeout(r, 500))
  const values = await ev(`JSON.stringify({
    input: document.getElementById('srds-input').value,
    textarea: document.getElementById('srds-ta').value,
  })`)
  const v = JSON.parse(values)
  console.log('  [3] 輸入框：', v.input)
  console.log('      編輯區：', v.textarea)
  console.log(`      ${v.input.includes('設定') && v.textarea.includes('設定') ? '✓ 沒有被動到' : '✗ 被改掉了'}`)

  // ---- 4. 小說正文走自己的設定 -------------------------------------------
  await goto(`/read/${projectId}`)
  const prose = await ev(`JSON.stringify((() => {
    const own = document.querySelector('[data-script-own]')
    if (!own) return { error: '找不到標記了 data-script-own 的正文欄' }
    const text = (own.innerText || '').slice(0, 400)
    return { head: text.slice(0, 60) }
  })())`)
  console.log('  [4] 正文：', prose)
} finally { chrome.kill() }
