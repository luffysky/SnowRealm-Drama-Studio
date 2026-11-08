/**
 * 匯入，從頭到尾在真的瀏覽器裡做一次 (Z190).
 *
 * 單元測試證明得了「對應算對了」，證明不了**對話框有沒有把那個對應送出去**
 * ——而第一版壞的就是那一段：它從來沒把「這是哪一區」傳給預覽端，於是貼上的
 * 內容與檔名認不出來的檔案一律靜靜地匯入 0 筆，沒有錯誤訊息。
 *
 * 所以這一支走完整條路：貼上 → 預覽 → 看對應 → 匯入 → 回頁面確認。
 *
 * **會真的寫資料**，所以跑在本機測試庫上。用法：
 *
 *     npx tsx scripts/seed-local-storyboard.ts
 *     TESTDB=$(grep -m1 '^TEST_DATABASE_URL=' .env.local | cut -d= -f2-)
 *     DATABASE_URL="$TESTDB" DATABASE_URL_UNPOOLED="$TESTDB" npm run dev
 *     node scripts/probe-import.mjs <projectId>
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

/*
 * 比對前折繁簡。
 *
 * 介面會依偏好轉字形，而「匯入」的簡體是「汇入」不是「导入」——猜簡體寫法這
 * 件事我已經錯過三次。折一次就不用猜。
 */
const fold = OpenCC.Converter({ from: 'tw', to: 'cn' })
const same = (haystack, needle) => fold(String(haystack)).includes(fold(needle))
const equal = (a, b) => fold(String(a).trim()) === fold(b)

const base = 'http://127.0.0.1:3400'
const PROJECT = process.argv[2]
if (!PROJECT) {
  console.error('用法：node scripts/probe-import.mjs <projectId>（見本檔開頭）')
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
const chrome = launchChrome(port, join(tmpdir(), `srds-imp-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * **一個**選擇器，不是兩個。
 *
 * 寫成 `'[role="dialog"], [aria-modal="true"]'` 的話，接上 ` button` 之後逗號
 * 會把它拆成 `[role="dialog"]` 與 `[aria-modal="true"] button` 兩條——前者命中
 * 的是對話框那個 div 本身，而它的 innerText 含「匯入」，於是「找匯入鍵」會找到
 * 第 0 筆那個 div，對它 `.click()` 不會報錯也不會有任何事發生。
 * Dialog.tsx 把兩個屬性放在同一個元素上，所以留一個就夠。
 */
const DIALOG = '[role="dialog"]'

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

  /*
   * 把匯入那一支的回應錄下來。
   *
   * 「按了沒反應」在畫面上跟「送出去但失敗了」長得一樣，而兩者要查的地方完
   * 全不同——所以先把事實拿到手。
   */
  const calls = []
  client.on('Network.responseReceived', (event) => {
    if (/\/api\/projects\/[^/]+\/import/.test(event.response.url)) {
      calls.push({ url: event.response.url.split('/').slice(-1)[0], status: event.response.status })
    }
  })

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
    await wait(2600)
  }

  /** 按鈕文字撈回 Node 再折，不要在頁面裡猜簡體寫法。 */
  const buttonTexts = (scope = '') =>
    json(`[...document.querySelectorAll('${scope} button')].map((b) => (b.innerText || '').trim())`)
  const clickButton = (index, scope = '') =>
    ev(`[...document.querySelectorAll('${scope} button')][${index}].click()`)

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false },
    sessionId
  )
  await go(`${base}/projects/${PROJECT}/storyboard`)

  const before = await ev(`document.querySelectorAll('[title^="第"]').length`)

  /* ---- 開匯入 ----------------------------------------------------------- */
  const buttons = await buttonTexts()
  const importIndex = buttons.findIndex((text) => equal(text, '匯入'))
  ok('分鏡工作台有「匯入」這顆', importIndex >= 0, JSON.stringify(buttons.slice(0, 12)))
  if (importIndex < 0) throw new Error('沒有匯入按鈕，後面的斷言沒有意義')

  await clickButton(importIndex)
  await wait(1200)
  ok('匯入視窗打得開', (await ev(`!!document.querySelector('${DIALOG}')`)) === true)

  /* ---- 貼一段 CSV ------------------------------------------------------- */
  /*
   * 貼上的內容**沒有檔名**，所以它正是第一版壞掉的那一條路：伺服器端認不出
   * 區塊，而對話框沒把預設區塊送過去。
   */
  const CSV = [
    '場次,秒數,景別,運鏡,畫面描述,負向提示詞',
    'ZZ9,8,過肩,固定,匯入測試用的鏡頭一,模糊',
    'ZZ9,12,近景,推軌進,匯入測試用的鏡頭二,多手',
  ].join('\n')

  const pasted = await ev(`(() => {
    const details = [...document.querySelectorAll('details')]
      .find((d) => (d.innerText || '').includes('Excel'))
    if (!details) return 'no details'
    details.open = true
    const area = details.querySelector('textarea')
    if (!area) return 'no textarea'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(area, ${JSON.stringify(CSV)})
    area.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
  ok('找得到貼上的輸入框', pasted === 'ok', String(pasted))

  const detailButtons = await buttonTexts('details')
  const readIndex = detailButtons.findIndex((text) => equal(text, '讀這段'))
  ok('有「讀這段」', readIndex >= 0, JSON.stringify(detailButtons))
  await clickButton(readIndex, 'details')

  /*
   * 等預覽回來。第一次打到這支路由時 dev server 要編譯它，所以要給久一點
   * ——而「還在忙」跟「壞了」在畫面上長得一樣，所以這裡等的是**檔案卡片出
   * 現**，不是等一個固定的秒數。
   */
  let card = { text: '', mapped: [] }
  for (let i = 0; i < 40; i += 1) {
    await wait(1000)
    card = await json(`(() => {
      const dialog = document.querySelector('${DIALOG}')
      if (!dialog) return { text: '', mapped: [] }
      return {
        text: dialog.innerText || '',
        mapped: [...dialog.querySelectorAll('select')]
          .map((s) => s.value)
          .filter((v) => v && !/^(shots|characters|world|episodes|chapters|scenes|tasks|expenses)$/.test(v)),
      }
    })()`)
    if (card.mapped.length > 0) break
  }
  ok('預覽回來了（不是卡在忙碌）', card.mapped.length > 0, card.text.slice(-160))

  /* ---- 這幾條就是那個 bug 的量尺 --------------------------------------- */
  ok(
    '貼上的內容有自動對應（不是每一欄都停在「不匯入」）',
    card.mapped.length >= 5,
    JSON.stringify(card.mapped)
  )
  ok(
    '負向提示詞對到負向欄位，不是正向',
    card.mapped.includes('negativePrompt') && !card.mapped.includes('prompt'),
    JSON.stringify(card.mapped)
  )
  ok('預覽說得出可匯入幾列', same(card.text, '可匯入 2'), card.text.slice(0, 140))
  ok(
    '認不得的景別「過肩」會被標成要新增',
    same(card.text, '過肩') && same(card.text, '會新增下拉選項')
  )

  /* ---- 真的匯入 --------------------------------------------------------- */
  const dialogButtons = await buttonTexts(DIALOG)
  /*
   * 忙碌時這顆寫「匯入中…」，閒下來才是「匯入 N 個檔案」。比對前綴而不是整
   * 串，而且要排掉忙碌態——不然會按到一顆 disabled 的按鈕然後以為沒反應。
   */
  const goIndex = dialogButtons.findIndex(
    (text) => fold(text).startsWith(fold('匯入')) && !same(text, '匯入中')
  )
  ok('視窗底下有「匯入 N 個檔案」', goIndex >= 0, dialogButtons[goIndex] ?? '（找不到）')

  /*
   * 按之前先看它是不是停用的。
   *
   * 對一顆 disabled 的按鈕呼叫 `.click()` 什麼都不會發生、也不會報錯——而那
   * 跟「按了但失敗」在畫面上長得一樣。
   */
  const state = await json(`(() => {
    const b = [...document.querySelectorAll('${DIALOG} button')][${goIndex}]
    const dialog = document.querySelector('${DIALOG}')
    const selects = [...dialog.querySelectorAll('select')]
    return {
      disabled: b ? b.disabled : null,
      target: selects[0] ? selects[0].value : null,
      episode: selects[1] ? selects[1].value : null,
    }
  })()`)
  ok('匯入鍵是可以按的', state.disabled === false, JSON.stringify(state))
  ok('區塊與集數都選好了', Boolean(state.target) && Boolean(state.episode), JSON.stringify(state))

  await clickButton(goIndex, DIALOG)

  let done = ''
  for (let i = 0; i < 16; i += 1) {
    await wait(1200)
    done = await ev(`(() => {
      const dialog = document.querySelector('${DIALOG}')
      return dialog ? (dialog.innerText || '') : ''
    })()`)
    if (same(done, '已匯入')) break
  }
  /*
   * **壞掉的版本會回「已匯入 0 筆」**——沒有錯誤、沒有訊息，只是什麼都沒發
   * 生。所以這一條比「有沒有報錯」更要緊。
   */
  const toast = await ev(`(() => {
    const nodes = [...document.querySelectorAll('[role="status"], [role="alert"], [data-toast]')]
    return nodes.map((n) => (n.innerText || '').trim()).join(' | ')
  })()`)
  ok(
    '匯入回報的是 2 筆，不是 0 筆',
    same(done, '已匯入 2 筆'),
    `呼叫：${JSON.stringify(calls)}　提示：${toast.slice(0, 200)}`
  )

  const closing = await buttonTexts(DIALOG)
  const closeIndex = closing.findIndex((text) => equal(text, '關閉'))
  if (closeIndex >= 0) await clickButton(closeIndex, DIALOG)
  await wait(2000)

  await go(`${base}/projects/${PROJECT}/storyboard`)
  const after = await ev(`document.querySelectorAll('[title^="第"]').length`)
  ok('分鏡清單真的多了兩個鏡頭', after === before + 2, `${before} → ${after}`)

  const body = await ev(`document.body.innerText || ''`)
  ok('新的景別「過肩」真的建起來了', same(body, '過肩'))
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
