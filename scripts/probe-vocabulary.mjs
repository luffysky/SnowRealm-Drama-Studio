/**
 * 可以自己加選項的下拉 (Z184)，在真的瀏覽器裡真的加一個。
 *
 * **跑在本機測試庫上**，不是正式庫：`vocabulary_terms` 是這一輪才建的表，而
 * 套 migration 到 Neon 是上線動作。三步：
 *
 *     npx tsx scripts/seed-local-storyboard.ts        # 建一個帶鏡頭的作品
 *     TESTDB=$(grep -m1 '^TEST_DATABASE_URL=' .env.local | cut -d= -f2-)
 *     DATABASE_URL="$TESTDB" DATABASE_URL_UNPOOLED="$TESTDB" npm run dev
 *     node scripts/probe-vocabulary.mjs <那支腳本印出來的 projectId>
 *
 * 跑完用 `seed-local-storyboard.ts drop` 連自訂詞一起清掉。
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
const PROJECT = process.argv[2]
if (!PROJECT) {
  console.error('用法：node scripts/probe-vocabulary.mjs <projectId>（見本檔開頭）')
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
const chrome = launchChrome(port, join(tmpdir(), `srds-voc-${Date.now()}`))
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
    await wait(2600)
  }

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false },
    sessionId
  )
  await mkdir('.shots', { recursive: true })

  await go(`${base}/projects/${PROJECT}/storyboard`)
  await ev(`(() => {
    const card = [...document.querySelectorAll('[title]')]
      .find((el) => /第 [0-9]+ 鏡/.test(el.getAttribute('title') || ''))
    if (card) card.click()
    return !!card
  })()`)
  await wait(1600)

  /** 景別那一格的下拉。 */
  const sizeSelect = `(() => {
    return [...document.querySelectorAll('select')]
      .find((s) => [...s.options].some((o) => o.value === 'MCU')) || null
  })()`

  const before = await json(`(() => {
    const s = ${sizeSelect}
    if (!s) return null
    return [...s.options].map((o) => o.value)
  })()`)
  ok('景別下拉找得到', Array.isArray(before), JSON.stringify(before))
  ok(
    '最後一項是「新增…」',
    before?.at(-1) === '+add',
    JSON.stringify(before?.slice(-3))
  )
  ok('內建那八個都在', before?.filter((v) => v !== '+add').length === 8)

  /* ---- 選到「新增…」會開表單，而且下拉自己彈回原值 -------------------- */
  const opened = await json(`(() => {
    const s = ${sizeSelect}
    const was = s.value
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(s, '+add')
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return { was }
  })()`)
  await wait(700)

  const form = await json(`(() => {
    const name = document.querySelector('input[aria-label="新的景別名稱"], input[aria-label="新的景别名称"]')
    const code = document.querySelector('input[aria-label="新的景別代碼"], input[aria-label="新的景别代码"]')
    return { name: !!name, code: !!code }
  })()`)
  ok('選到「新增…」會開出表單（名稱＋代碼兩格）', form.name && form.code, JSON.stringify(form))

  /*
   * 按取消之後，下拉要回到原本那個值。
   *
   * 「新增…」是下拉裡的一個哨兵選項，所以選到它的那一刻 `<select>` 已經把自
   * 己顯示成「新增…」了。沒有把它彈回去的話，取消之後那一格會停在一個**不是
   * 值的東西**上，而下一次存檔就把它送出去。
   */
  await ev(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').trim() === '取消')
    if (button) button.click()
    return !!button
  })()`)
  await wait(600)
  const restored = await ev(`(() => { const s = ${sizeSelect}; return s ? s.value : null })()`)
  ok('按取消之後下拉回到原值，不會停在哨兵上', restored === opened.was, `${opened.was} → ${restored}`)

  // 再開一次，這次真的填。
  await ev(`(() => {
    const s = ${sizeSelect}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(s, '+add')
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await wait(700)

  /* ---- 填完送出 -------------------------------------------------------- */
  const LABEL = `過肩 ${Date.now() % 100000}`
  await ev(`(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const name = document.querySelector('input[aria-label="新的景別名稱"], input[aria-label="新的景别名称"]')
    const code = document.querySelector('input[aria-label="新的景別代碼"], input[aria-label="新的景别代码"]')
    setter.call(name, ${JSON.stringify(LABEL)})
    name.dispatchEvent(new Event('input', { bubbles: true }))
    setter.call(code, 'Z184_OTS')
    code.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await wait(400)
  await ev(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').trim() === '新增')
    if (button) button.click()
    return !!button
  })()`)

  let after = null
  for (let i = 0; i < 14; i += 1) {
    await wait(1200)
    after = await json(`(() => {
      const s = ${sizeSelect}
      if (!s) return null
      return { values: [...s.options].map((o) => o.value), selected: s.value }
    })()`)
    if (after?.values?.includes('Z184_OTS')) break
  }

  ok('新增之後它就在下拉裡了', after?.values?.includes('Z184_OTS') === true, JSON.stringify(after?.values))
  ok('而且順手幫你選中了它', after?.selected === 'Z184_OTS', String(after?.selected))
  ok(
    '內建的還在前面，自訂的接在後面',
    after?.values?.[0] === 'EWS' && after?.values?.at(-2) === 'Z184_OTS',
    JSON.stringify(after?.values?.slice(-3))
  )

  const chip = await ev(
    `!!document.querySelector('[aria-label^="刪除景別"], [aria-label^="删除景别"]')`
  )
  ok('下面列出自訂的那幾個，可以刪', chip === true)

  const { data } = await client.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    sessionId
  )
  await writeFile(join('.shots', 'vocabulary-select.png'), Buffer.from(data, 'base64'))

  /* ---- 存進去，而且重整之後還在 ---------------------------------------- */
  await ev(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => /儲存這個鏡頭|储存这个镜头/.test(b.innerText || ''))
    if (button) button.click()
    return !!button
  })()`)
  await wait(2500)

  const location = await ev(`location.href`)
  await go(location)
  const persisted = await json(`(() => {
    const s = ${sizeSelect}
    return { selected: s ? s.value : null, body: /過肩|过肩/.test(document.body.innerText || '') }
  })()`)
  ok(
    '存起來之後重整，鏡頭還是那個自訂景別',
    persisted.selected === 'Z184_OTS',
    JSON.stringify(persisted)
  )

  /* ---- 收拾 ------------------------------------------------------------- */
  const cleaned = JSON.parse(await ev(`(async () => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('srds_csrf='))
    const token = csrf ? decodeURIComponent(csrf.slice('srds_csrf='.length)) : ''
    const list = await fetch('/api/vocabulary', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-csrf-token': token,
    }, body: JSON.stringify({ kind: 'shot_size', value: 'Z184_OTS', label: 'dup' }) })
    return JSON.stringify({ duplicate: list.status })
  })()`))
  ok('同一個代碼加第二次會被擋', cleaned.duplicate === 400, JSON.stringify(cleaned))

  /*
   * 收拾：把自己加的那一個刪掉，順便驗刪除那條路。
   *
   * 這一步在 migration 套到正式庫之後變成**必要**的——沒有它，每跑一次就在
   * 大家的景別下拉裡多一個 `Z184_OTS`。
   */
  const removed = JSON.parse(await ev(`(async () => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('srds_csrf='))
    const token = csrf ? decodeURIComponent(csrf.slice('srds_csrf='.length)) : ''
    const chip = document.querySelector('[aria-label^="刪除景別"], [aria-label^="删除景别"]')
    if (!chip) return JSON.stringify({ found: false })
    chip.click()
    await new Promise((r) => setTimeout(r, 2500))
    const s = ${sizeSelect}
    return JSON.stringify({
      found: true,
      left: s ? [...s.options].map((o) => ({ v: o.value, t: o.text })) : null,
      chips: document.querySelectorAll('[aria-label^="刪除景別"], [aria-label^="删除景别"]').length,
    })
  })()`))

  /*
   * 刪完之後 `Z184_OTS` **還在下拉裡**，而那是對的。
   *
   * 這個鏡頭現在的值就是它，而一個 `<select>` 碰到不在選項裡的值會自己跳到
   * 第一個——那等於**沒有人按就改了資料**。所以那個值會被補成一個標著「已從
   * 清單移除」的項目。要看的是：它不再是可管理的那一個（刪除的叉叉沒了）。
   */
  const orphan = removed.left?.find((o) => o.v === 'Z184_OTS')
  ok(
    '刪得掉：自訂的那一個不見了，只剩下標著「已移除」的現值',
    removed.found === true && removed.chips === 0 && /已從清單移除|已从清单移除/.test(orphan?.t ?? ''),
    JSON.stringify({ orphan, chips: removed.chips })
  )
  ok(
    '刪掉之後那個鏡頭還是顯示得出那個值',
    await ev(`/Z184_OTS/.test(document.body.innerText || '')`),
    '（這張表是「下拉裡有哪些選項」，不是「資料裡有哪些值」）'
  )

  /* 鏡頭也要改回內建值，不然正式庫裡留著一個指向已刪選項的鏡頭。 */
  await ev(`(() => {
    const s = ${sizeSelect}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(s, 'MS')
    s.dispatchEvent(new Event('change', { bubbles: true }))
    const save = [...document.querySelectorAll('button')]
      .find((b) => /儲存這個鏡頭|储存这个镜头/.test(b.innerText || ''))
    if (save) save.click()
    return true
  })()`)
  await wait(2500)
  ok(
    '收拾完畢：鏡頭改回內建的景別',
    (await ev(`(() => { const s = ${sizeSelect}; return s ? s.value : null })()`)) === 'MS'
  )
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
