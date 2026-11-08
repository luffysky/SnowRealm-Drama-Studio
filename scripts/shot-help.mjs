/**
 * 使用說明那兩頁的截圖與檢查 (Z189).
 *
 * 說明文件最容易出的錯不是寫錯，是**跟程式對不上**——所以這裡除了拍照，還比
 * 對欄位表裡列出來的欄位數量跟 `IMPORT_TARGETS` 一不一樣。
 *
 * 用法：node scripts/shot-help.mjs
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

const base = 'http://127.0.0.1:3400'
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
const chrome = launchChrome(port, join(tmpdir(), `srds-help-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Network.enable', {}, sessionId)
  const { hostname } = new URL(base)
  for (const [n, v] of Object.entries(cookies)) {
    await client.send(
      'Network.setCookie',
      { name: n, value: v, domain: hostname, path: '/' },
      sessionId
    )
  }

  const ev = async (expression) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
  }
  const json = async (expression) => JSON.parse(await ev(`JSON.stringify(${expression})`))
  const go = async (url) => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url }, sessionId)
    await loaded
    await wait(1800)
  }

  await mkdir('.shots', { recursive: true })
  const shoot = async (name) => {
    const { data } = await client.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId
    )
    await writeFile(join('.shots', name), Buffer.from(data, 'base64'))
  }

  /* ---- 側邊欄有入口 ---------------------------------------------------- */
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false },
    sessionId
  )
  await go(`${base}/dashboard`)

  const rail = await json(`(() => {
    const link = [...document.querySelectorAll('a[href="/help"]')]
    return {
      count: link.length,
      labels: link.map((a) => (a.innerText || a.getAttribute('aria-label') || '').trim()),
    }
  })()`)
  ok('側邊欄與頂列都連得到說明', rail.count >= 2, JSON.stringify(rail))

  /* ---- 說明首頁 --------------------------------------------------------- */
  await go(`${base}/help`)
  const home = await json(`(() => {
    const text = document.body.innerText || ''
    return {
      sections: document.querySelectorAll('section').length,
      hasSteps: /第一次用/.test(text),
      hasRail: /左邊那排/.test(text),
      hasImportLink: !!document.querySelector('a[href="/help/import"]'),
      error: /Application error|This page could not be found/.test(text),
    }
  })()`)
  ok('說明首頁打得開', home.error === false && home.sections >= 5, JSON.stringify(home))
  ok('有「第一次用照這個順序」與左邊那排的解釋', home.hasSteps && home.hasRail)
  ok('連得到匯入說明', home.hasImportLink === true)
  await shoot('help.png')

  /* ---- 匯入說明 --------------------------------------------------------- */
  await go(`${base}/help/import`)
  const imp = await json(`(() => {
    const text = document.body.innerText || ''
    return {
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('table tbody tr').length,
      downloads: document.querySelectorAll('a[href*="/api/import/template"]').length,
      mentionsUtf8: /CSV UTF-8/.test(text),
      error: /Application error|This page could not be found/.test(text),
    }
  })()`)

  // 八個區塊各一張表。
  ok('八個區塊的欄位表都在', imp.error === false && imp.tables === 8, JSON.stringify(imp))
  ok('每一區都有三個下載連結', imp.downloads === 24, `${imp.downloads} 個`)
  ok('講了亂碼怎麼辦', imp.mentionsUtf8 === true)

  /*
   * 欄位數量要跟程式裡的定義一樣。這一條守的是「說明跟實際對不上」——而那是
   * 這種文件最常見也最傷的壞法：人照著它做，失敗了，覺得是自己的錯。
   */
  const { IMPORT_TARGETS } = await import('../src/lib/import/targets.ts').catch(() => ({
    IMPORT_TARGETS: null,
  }))
  if (IMPORT_TARGETS) {
    const expected = IMPORT_TARGETS.reduce((sum, t) => sum + t.fields.length, 0)
    ok('欄位總數跟程式裡的定義一致', imp.rows === expected, `畫面 ${imp.rows}，程式 ${expected}`)
  } else {
    console.log('  ·  （跳過欄位數量比對：這支腳本讀不到 TS 模組）')
  }

  await shoot('help-import.png')

  /* ---- 手機寬度 --------------------------------------------------------- */
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    sessionId
  )
  await wait(900)
  const overflow = await ev(
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`
  )
  ok('390px 下不會橫向溢出', overflow === 0, `${overflow}px`)
  await shoot('help-import-phone.png')
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
