/**
 * 分鏡參考圖、角色圖不限長寬、放大鏡 (Z188／Z181／Z183).
 *
 * 這一支**會真的上傳檔案**（兩張 24×36 的 PNG），因為「上傳」正是要驗的東
 * 西。跑完它自己把連結拆掉、素材刪掉，所以資料庫回到原狀——但它不是零副作用
 * 的，別在正式環境跑。
 *
 * 用法：node scripts/probe-reference-images.mjs
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
const PROJECT = '935dc410-79dc-48df-8834-887e9dc59597'

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
const chrome = launchChrome(port, join(tmpdir(), `srds-ref-${Date.now()}`))
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
  const shoot = async (name) => {
    const { data } = await client.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId
    )
    await writeFile(join('.shots', name), Buffer.from(data, 'base64'))
  }

  /** 參考圖那一區，用標題找——這一頁的字會被繁簡轉換，所以兩種都收。 */
  const sectionJs = `(() => {
    const head = [...document.querySelectorAll('h4')]
      .find((h) => /參考圖|参考图/.test(h.innerText || ''))
    return head ? head.closest('section') : null
  })()`

  /* ---- 1. 景別清單有「近景」 ------------------------------------------ */
  await go(`${base}/projects/${PROJECT}/storyboard`)

  const sizes = await json(`(() => {
    const select = [...document.querySelectorAll('select')]
      .find((s) => [...s.options].some((o) => /EWS|MCU/.test(o.value)))
    if (!select) return null
    return [...select.options].map((o) => ({ value: o.value, label: o.text }))
  })()`)
  ok(
    '景別清單裡有「近景」，而且沒有「中近景」',
    Array.isArray(sizes) &&
      sizes.some((o) => o.value === 'MCU' && /近景/.test(o.label)) &&
      !sizes.some((o) => /中近景/.test(o.label)),
    sizes ? sizes.map((o) => o.label).join('、') : '找不到景別下拉'
  )

  /* ---- 2. 參考圖那一區 ------------------------------------------------ */
  const area = await json(`(() => {
    const root = ${sectionJs}
    if (!root) return { found: false }
    return {
      found: true,
      addButton: [...root.querySelectorAll('button')]
        .some((b) => /加參考圖|加参考图/.test(b.innerText || '')),
      multiple: !!root.querySelector('input[type="file"][multiple]'),
      figures: root.querySelectorAll('figure').length,
    }
  })()`)
  ok('鏡頭詳情有「參考圖」這一區', area.found === true, JSON.stringify(area))
  ok('有「加參考圖」，而且檔案選擇器收多選', area.addButton && area.multiple === true)

  /*
   * 點一個鏡頭，網址才會帶 `?shot=`——收拾的時候要用它組路徑。
   *
   * 標籤要兩種字形都收：介面會依偏好做繁簡轉換，而第一版只寫了「鏡」，在簡
   * 體介面上永遠找不到（畫面顯示的是「第 1 镜」）。
   */
  await ev(`(() => {
    /*
     * 比對的是 title 屬性，不是看得見的文字。
     *
     * 鏡頭卡片上看得見的是集號與畫面描述，「第 N 鏡」只寫在 title 裡——而那
     * 剛好也躲開了繁簡轉換（那一支只碰文字節點，不碰屬性）。
     */
    const card = [...document.querySelectorAll('[title]')]
      .find((el) => /第 [0-9]+ 鏡/.test(el.getAttribute('title') || ''))
    if (card) card.click()
    return !!card
  })()`)
  await wait(1800)
  const shotId = await ev(`new URL(location.href).searchParams.get('shot')`)
  ok('點一個鏡頭之後網址帶著它', typeof shotId === 'string' && shotId.length > 0, String(shotId))

  const before = area.figures

  /*
   * 真的塞兩個檔案進去：`DataTransfer` 造一個 FileList，再對 input 發
   * `change`——跟使用者從檔案選擇器挑完走的是同一條路。
   */
  await ev(`(async () => {
    const input = ${sectionJs}.querySelector('input[type="file"][multiple]')
    const make = async (r, g, b, name) => {
      const canvas = document.createElement('canvas')
      canvas.width = 24
      canvas.height = 36
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'
      ctx.fillRect(0, 0, 24, 36)
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      return new File([blob], name, { type: 'image/png' })
    }
    const dt = new DataTransfer()
    dt.items.add(await make(200, 40, 40, 'srds-probe-ref-a.png'))
    dt.items.add(await make(40, 90, 220, 'srds-probe-ref-b.png'))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)

  // 上傳要簽 R2、回報完成，再 router.refresh()。給它久一點。
  let after = before
  for (let i = 0; i < 20; i += 1) {
    await wait(1500)
    after = await ev(`(() => {
      const root = ${sectionJs}
      return root ? root.querySelectorAll('figure').length : 0
    })()`)
    if (after >= before + 2) break
  }
  ok('一次選兩張，兩張都掛上去了', after === before + 2, `${before} → ${after}`)

  const mine = await json(`(() => {
    const root = ${sectionJs}
    return [...root.querySelectorAll('figure img')]
      .filter((img) => /srds-probe-ref/.test(img.alt || ''))
      .map((img) => (img.getAttribute('src') || '').split('/').pop().split('?')[0])
  })()`)
  ok('認得出哪兩張是這支 probe 傳的', mine.length === 2, JSON.stringify(mine))

  ok(
    '參考圖是照原比例顯示的，沒有被裁',
    (await ev(`(() => {
      const img = ${sectionJs}.querySelector('figure img')
      return img ? getComputedStyle(img).objectFit : 'none'
    })()`)) === 'contain'
  )

  await shoot('reference-images.png')

  /* ---- 3. 放大鏡 ------------------------------------------------------- */
  /*
   * 先捲到看得見，再量座標。
   *
   * `getBoundingClientRect()` 是相對視窗的，而參考圖在摺線以下——第一版量到
   * 的 y 超出視窗高度，CDP 就把滑鼠事件丟到畫面外，於是報「放大鏡沒出現」。
   * 而它只是沒被碰到。
   */
  await ev(`(() => {
    ${sectionJs}.querySelector('figure').scrollIntoView({ block: 'center' })
    return true
  })()`)
  await wait(500)

  const at = await json(`(() => {
    const fig = ${sectionJs}.querySelector('figure')
    const box = fig.getBoundingClientRect()
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
  })()`)
  ok('參考圖在視窗內（不然丟滑鼠事件是丟空氣）', at.y > 0 && at.y < 1100, JSON.stringify(at))

  await client.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: at.x, y: at.y, pointerType: 'mouse' },
    sessionId
  )
  await wait(500)

  /*
   * 找放大鏡那一塊：它是 portal 到 `body` 的直接子節點，`position: fixed` 由
   * class 給、`background-image` 由 inline style 給。第一版用
   * `el.style.position === 'fixed'` 找，而那讀的是 **inline** style——永遠是
   * 空字串，所以它報「沒出現」而那一塊好好地在畫面上。
   */
  const lensJs = `[...document.body.children].filter(
    (el) => el.style && el.style.backgroundImage && getComputedStyle(el).position === 'fixed'
  )`
  const lens = await json(`(() => {
    const panel = ${lensJs}[0]
    if (!panel) return { shown: false }
    const box = panel.getBoundingClientRect()
    return {
      shown: true,
      size: Math.round(box.width),
      zoom: panel.style.backgroundSize,
      position: panel.style.backgroundPosition,
      inViewport:
        box.left >= 0 &&
        box.right <= window.innerWidth &&
        box.top >= 0 &&
        box.bottom <= window.innerHeight,
    }
  })()`)
  ok('滑鼠移到參考圖上會出現放大鏡', lens.shown === true, JSON.stringify(lens))
  ok(
    '放大鏡真的放大了，而且整塊在畫面內',
    lens.shown && lens.zoom?.startsWith('250%') && lens.inViewport === true,
    JSON.stringify(lens)
  )

  /* 游標往左移，放大的位置要跟著變——不然它只是一張固定的大圖。 */
  await client.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: at.x - 30, y: at.y, pointerType: 'mouse' },
    sessionId
  )
  await wait(300)
  const moved = await ev(`(${lensJs}[0] || {}).style?.backgroundPosition ?? 'none'`)
  ok('放大的位置跟著游標走', moved !== lens.position && moved !== 'none', `${lens.position} → ${moved}`)

  await shoot('zoom-lens.png')

  await client.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: 5, y: 5, pointerType: 'mouse' },
    sessionId
  )
  await wait(400)
  ok('滑鼠移開就收掉，不會留一塊擋在畫面上', (await ev(`${lensJs}.length`)) === 0)

  /* ---- 4. 收拾 --------------------------------------------------------- */
  /*
   * 這一段自己 stringify，不走 `json()`。
   *
   * `JSON.stringify(<async IIFE>)` 轉的是 Promise 本身，結果永遠是 `{}`——
   * 第一版就是這樣報「收拾失敗」而兩個請求其實都 200。`awaitPromise` 等的是
   * 最外層那一個，所以要在裡面轉好再回傳。
   *
   * （註解寫在模板字串**外面**：裡面放反引號會把模板字串提前結束掉。）
   */
  const cleaned = JSON.parse(await ev(`(async () => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('srds_csrf='))
    const token = csrf ? decodeURIComponent(csrf.slice('srds_csrf='.length)) : ''
    const out = []
    for (const assetId of ${JSON.stringify(mine)}) {
      const unlink = await fetch(
        '/api/projects/${PROJECT}/shots/${shotId}/references/' + assetId,
        { method: 'DELETE', headers: { 'x-csrf-token': token } }
      )
      const drop = await fetch('/api/projects/${PROJECT}/assets/' + assetId, {
        method: 'DELETE',
        headers: { 'x-csrf-token': token },
      })
      out.push({ unlink: unlink.status, drop: drop.status })
    }
    return JSON.stringify(out)
  })()`))
  ok(
    '收拾乾淨：連結拆掉、素材也刪掉',
    cleaned.length === mine.length && cleaned.every((r) => r.unlink === 200 && r.drop === 200),
    JSON.stringify(cleaned)
  )

  /* ---- 5. 角色圖不限長寬 ---------------------------------------------- */
  await go(`${base}/projects/${PROJECT}/characters`)
  await ev(`(() => {
    const row = [...document.querySelectorAll('button,a')].find((el) => /沈/.test(el.innerText || ''))
    if (row) row.click()
    return !!row
  })()`)
  await wait(2000)

  const portrait = await json(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => /新增角色圖|新增角色图/.test(b.innerText || ''))
    if (!button) return { opened: false, hint: false, fits: [] }

    /*
     * 範圍是**角色那一欄**，不是整頁。整頁掃的話會掃到作品頁首的封面，而那
     * 張本來就該 object-cover——它真的有一個 16:9 的框，而且人對著那個框裁
     * 過。第一版沒分，於是報「兩張被裁切」而那兩張是對的。
     */
    let scope = button
    for (let i = 0; i < 6; i += 1) {
      const up = scope.parentElement
      if (!up) break
      scope = up
      if (scope.querySelectorAll('img').length >= 2) break
    }

    return {
      opened: true,
      hint: /不限長寬|不限长宽/.test(scope.innerText || ''),
      fits: [...scope.querySelectorAll('img')].map((i) => getComputedStyle(i).objectFit),
    }
  })()`)
  ok('角色面板打得開', portrait.opened === true)
  ok('角色圖的說明寫著「不限長寬」', portrait.hint === true)
  ok(
    '角色那一欄沒有任何一張圖被裁切顯示',
    portrait.fits.length >= 2 && portrait.fits.every((fit) => fit === 'contain'),
    `${portrait.fits.length} 張：${JSON.stringify(portrait.fits)}`
  )
  await shoot('character-free-aspect.png')
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
