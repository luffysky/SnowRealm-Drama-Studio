/**
 * 一鏡多人說話，在真的瀏覽器裡點一次 (Z194).
 *
 * 單元測試證明得了「匯入那一格拆得對」，證明不了**畫面上點兩個名字之後存下
 * 去，重新整理還在**——而那是這個功能唯一要緊的事。
 *
 * **會真的寫資料**，所以跑在本機測試庫上。用法：
 *
 *     npx tsx scripts/seed-local-storyboard.ts
 *     TESTDB=$(grep -m1 '^TEST_DATABASE_URL=' .env.local | cut -d= -f2-)
 *     DATABASE_URL="$TESTDB" DATABASE_URL_UNPOOLED="$TESTDB" npm run dev
 *     node scripts/probe-speakers.mjs <projectId>
 *     npx tsx scripts/seed-local-storyboard.ts drop
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import * as OpenCC from 'opencc-js'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

/* 介面會依偏好轉字形，而猜簡體寫法這件事我已經錯過四次。折一次就不用猜。 */
const fold = OpenCC.Converter({ from: 'tw', to: 'cn' })
const same = (haystack, needle) => fold(String(haystack)).includes(fold(needle))

const base = 'http://127.0.0.1:3400'
const PROJECT = process.argv[2]
if (!PROJECT) {
  console.error('用法：node scripts/probe-speakers.mjs <projectId>（見本檔開頭）')
  process.exit(2)
}

let pass = 0
let fail = 0
const ok = (label, good, detail = '') => {
  if (good) {
    pass += 1
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`)
  }
}

const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-spk-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

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

  const calls = []
  client.on('Network.responseReceived', (event) => {
    if (/\/api\/projects\/[^/]+\/shots\//.test(event.response.url)) {
      calls.push({ method: 'PATCH', status: event.response.status })
    }
  })

  const ev = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  const json = async (expression) => JSON.parse(await ev(`JSON.stringify(${expression})`))
  const go = async (url) => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url }, sessionId)
    await loaded
    await wait(2800)
  }

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false },
    sessionId
  )

  /*
   * 先確認這部作品有角色可以點。
   *
   * 沒有角色的話挑選器會顯示「還沒有角色可以選。」而底下每一條斷言都會
   * 「通過」——通過的理由是沒有東西可以點，那不是這支要證明的事。
   */
  await go(`${base}/projects/${PROJECT}/storyboard`)

  const picker = () =>
    json(`(() => {
      const label = [...document.querySelectorAll('*')]
        .find((el) => el.children.length === 0 && /誰說的|谁说的/.test(el.textContent || ''))
      if (!label) return { found: false }
      const field = label.closest('div')?.parentElement ?? label.parentElement
      const buttons = [...(field?.querySelectorAll('button[aria-pressed]') ?? [])]
      return {
        found: true,
        names: buttons.map((b) => (b.innerText || '').trim()),
        pressed: buttons
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => (b.innerText || '').trim()),
      }
    })()`)

  const before = await picker()
  ok('鏡頭詳情裡找得到「誰說的」的複選', before.found && before.names.length > 0, JSON.stringify(before))
  if (!before.found || before.names.length < 2) {
    throw new Error('這部作品的角色少於兩個，證明不了「多人」這件事')
  }

  /* ---- 點兩個名字 ------------------------------------------------------- */
  const pick = (index) =>
    ev(`(() => {
      const label = [...document.querySelectorAll('*')]
        .find((el) => el.children.length === 0 && /誰說的|谁说的/.test(el.textContent || ''))
      const field = label.closest('div')?.parentElement ?? label.parentElement
      const buttons = [...field.querySelectorAll('button[aria-pressed]')]
      buttons[${index}].scrollIntoView({ block: 'center' })
      buttons[${index}].click()
    })()`)

  await pick(0)
  await pick(1)
  await wait(400)

  const picked = await picker()
  ok('兩個都按下去了（aria-pressed）', picked.pressed.length === 2, JSON.stringify(picked.pressed))

  const wanted = picked.pressed

  /* ---- 存檔 ------------------------------------------------------------- */
  const saveIndex = await json(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    return buttons.findIndex((b) => /^(儲存|保存|储存)/.test((b.innerText || '').trim()))
  })()`)
  ok('找得到儲存鍵', saveIndex >= 0, String(saveIndex))

  await ev(`(() => {
    const b = [...document.querySelectorAll('button')][${saveIndex}]
    b.scrollIntoView({ block: 'center' })
    b.click()
  })()`)

  for (let i = 0; i < 20; i += 1) {
    await wait(500)
    if (calls.length > 0) break
  }
  ok('真的打了 PATCH', calls.length > 0 && calls[0].status < 400, JSON.stringify(calls))

  /* ---- 重新整理，看還在不在 --------------------------------------------- */
  await go(`${base}/projects/${PROJECT}/storyboard`)
  const after = await picker()
  ok(
    '重新整理之後兩個人還在',
    wanted.every((name) => after.pressed.includes(name)) && after.pressed.length === wanted.length,
    `存的是 ${JSON.stringify(wanted)}，讀回來是 ${JSON.stringify(after.pressed)}`
  )

  /* 卡片上的那一行也要寫出兩個名字，不是只寫第一個。 */
  const card = await ev(`document.body.innerText || ''`)
  ok(
    '鏡頭卡片上兩個名字都寫出來了',
    wanted.every((name) => same(card, name)) && same(card, '、'),
    wanted.join('、')
  )
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
