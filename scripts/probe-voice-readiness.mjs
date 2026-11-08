/**
 * 小說工作台的「對白歸屬與配音」總覽 (Z147).
 *
 * 斷言的是**畫面上的數字跟資料庫一致**，不是「有一塊東西長出來」。一個總覽
 * 最糟的壞法不是不顯示，是顯示一個看起來很合理但是錯的數字——那種錯沒有人
 * 會回報，只會拿去做決定。
 *
 * 用法：node scripts/probe-voice-readiness.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import * as OpenCC from 'opencc-js'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

/*
 * 比對之前兩邊都折成簡體。
 *
 * 介面會依使用者的偏好做繁簡轉換（Z135／Z172），所以「對白歸屬與配音」在畫面
 * 上可能是「对白归属与配音」。第一版的斷言寫死繁體，於是這支 probe 報「沒有
 * 這一區」——而那一區好好的在那裡。**一支會因為字形而誤報的量尺，比沒有量尺
 * 更花時間**，因為它看起來像真的壞了。
 */
const fold = OpenCC.Converter({ from: 'tw', to: 'cn' })
const same = (haystack, needle) => fold(haystack).includes(fold(needle))

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

/* ---- 先問資料庫，再去比畫面 ------------------------------------------- */
const truth = await (async () => {
  const { execSync } = await import('node:child_process')
  const out = execSync('npx tsx scripts/voice-readiness-truth.ts', {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return JSON.parse(out.slice(out.indexOf('{')))
})()

console.log(`  ·  資料庫說：已動筆 ${truth.written} 集、判過 ${truth.judged} 集、有聲 ${truth.voiced} 集`)
console.log(`  ·  音檔裡只有旁白：${truth.noSpeakers.join('、') || '（無）'}`)
console.log(`  ·  音檔比歸屬舊：${truth.outdated.join('、') || '（無）'}`)

const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-vr-${Date.now()}`))
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
    await wait(2200)
  }

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false },
    sessionId
  )
  await mkdir('.shots', { recursive: true })

  await go(`${base}/projects/${PROJECT}/novel`)

  const section = await json(`(() => {
    const heads = [...document.querySelectorAll('h3')]
    const head = heads.find((h) => /對白歸屬與配音|对白归属与配音/.test(h.innerText || ''))
    if (!head) return { found: false }
    const root = head.closest('section')
    if (!root) return { found: false }
    const list = root.querySelector('ul')
    const rows = list ? [...list.querySelectorAll('li')].map((li) => li.innerText || '') : []
    /*
     * 警告段落＝這一區裡**不在清單中**的每一段文字。
     *
     * 在 innerText 上用 indexOf('EP') 切窗口的那個寫法會把清單的第一行也切進
     * 來，於是「警告有沒有提到 EP001」永遠是真。而第二版寫 :scope > p 又太
     * 窄：警示後來拆成自己的元件，那些 <p> 變成孫節點，於是這一格永遠是空
     * 字串——而空字串讓「警示有寫某某」全部紅，看起來像功能壞了。
     */
    const rows0 = root.querySelector('ul')
    const banner = [...root.querySelectorAll('p')]
      .filter((p) => !rows0 || !rows0.contains(p))
      .map((p) => p.innerText || '')
      .join(String.fromCharCode(10))
    return {
      found: true,
      text: root.innerText || '',
      banner,
      rows,
      link: (root.querySelector('a[href*="tab=audio"]') || {}).getAttribute?.('href') ?? null,
    }
  })()`)

  if (!section.found) {
    const page = await ev(`(document.body.innerText || '').slice(0, 400)`)
    ok('小說工作台有「對白歸屬與配音」這一區', false, `頁面開頭：${JSON.stringify(page)}`)
    throw new Error('沒有這一區，後面的斷言沒有意義')
  }
  ok('小說工作台有「對白歸屬與配音」這一區', true)

  const order = await json(`(() => {
    const heads = [...document.querySelectorAll('h2,h3')]
    const mine = heads.find((h) => /對白歸屬與配音|对白归属与配音/.test(h.innerText || ''))
    const outline = heads.find((h) => /分集大綱|分集大纲/.test(h.innerText || ''))
    if (!mine || !outline) return { mine: null, outline: null }
    return {
      mine: Math.round(mine.getBoundingClientRect().top + window.scrollY),
      outline: Math.round(outline.getBoundingClientRect().top + window.scrollY),
    }
  })()`)
  ok(
    '它在分集大綱上面——在下面的話要捲過一百二十行才看得到',
    typeof order.mine === 'number' && typeof order.outline === 'number' && order.mine < order.outline,
    JSON.stringify(order)
  )

  /*
   * 只列**判過或有聲音**的那幾集。列已動筆的全部會讓這一區的高度跟集數成正
   * 比，而它就在一張一百二十行的分集大綱上面。
   */
  ok(
    `列的是有進度的那幾集（${truth.startedLabels.length} 集）`,
    section.rows.length === truth.startedLabels.length,
    `畫面 ${section.rows.length} 行，資料庫說 ${truth.startedLabels.join('、') || '（無）'}`
  )
  if (truth.untouched > 0 && truth.startedLabels.length > 0) {
    ok(
      `其餘 ${truth.untouched} 集用一行總結，不佔一百二十行`,
      same(section.text, `其餘 ${truth.untouched} 集已動筆但還沒判過`),
      JSON.stringify(section.text.split(String.fromCharCode(10)).slice(-1)[0])
    )
  }

  const summary = `已動筆 ${truth.written} 集：${truth.judged} 集判過對白歸屬、${truth.voiced} 集做出有聲書`
  ok('摘要那一行的三個數字跟資料庫一致', same(section.text, summary), `期望「${summary}」`)

  const stale = [...truth.noSpeakers, ...truth.outdated]
  if (stale.length > 0) {
    ok(
      '音檔裡只有一個聲音的那幾集被標出來了',
      stale.every((label) => section.banner.includes(label)),
      stale.join('、')
    )
    if (truth.noSpeakers.length > 0) {
      ok('「整集都是旁白」那一句在', same(section.banner, '整集都是旁白的聲音'))
    }
    if (truth.outdated.length > 0) {
      // 先合成、後判斷：判斷已經有了，只差重新合成一次，說法要不一樣。
      ok('「在對白歸屬之前做的」那一句在', same(section.banner, '在對白歸屬之前做的'))
    }
    ok(
      '警示沒有把沒問題的那幾集也算進去',
      !section.rows
        .filter((row) => !stale.some((label) => row.includes(label)))
        .some((row) => {
          const label = (row.match(/EP\d{3}/) || [])[0]
          return label ? section.banner.includes(label) : false
        }),
      `警示寫：${JSON.stringify(section.banner.slice(0, 70))}`
    )
  } else {
    ok('沒有需要重做的集數時不顯示警示', !same(section.text, '整集都是旁白'))
  }

  const unjudgedRows = section.rows.filter((row) => same(row, '沒判過'))
  const expectedUnjudged = truth.startedLabels.filter(
    (label) => !truth.judgedLabels.includes(label)
  ).length
  ok(
    '清單裡「沒判過」的行數跟資料庫一致',
    unjudgedRows.length === expectedUnjudged,
    `清單裡 ${unjudgedRows.length} 行，應為 ${expectedUnjudged}`
  )

  for (const label of truth.judgedLabels) {
    const row = section.rows.find((text) => text.includes(label))
    ok(
      `${label} 那一行寫的是判過，不是沒判過`,
      Boolean(row) && same(row ?? '', '判過') && !same(row ?? '', '沒判過'),
      JSON.stringify((row ?? '').replace(/\n/g, ' ').slice(0, 60))
    )
  }

  const { data } = await client.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    sessionId
  )
  await writeFile(join('.shots', 'voice-readiness.png'), Buffer.from(data, 'base64'))

  /* ---- 那個連結真的落在「有聲」分頁 ---------------------------------- */
  ok('摘要列有一條通往逐集操作的連結', typeof section.link === 'string', String(section.link))

  await go(`${base}/read/${PROJECT}?tab=audio`)
  const landed = await json(`(() => {
    const tab = document.querySelector('[role="tab"][data-tab-id="audio"]')
    return {
      exists: !!tab,
      selected: tab ? tab.getAttribute('aria-selected') === 'true' : false,
      label: tab ? (tab.innerText || '').trim().split(String.fromCharCode(10))[0] : null,
      /* 有聲分頁才有的那兩顆動作。 */
      actions: /試算|合成|判斷|试算|判断/.test(document.body.innerText || ''),
    }
  })()`)
  ok(
    '?tab=audio 直接開在「有聲」分頁，而且那一頁的動作在',
    landed.exists && landed.selected && landed.actions,
    JSON.stringify(landed)
  )

  await go(`${base}/read/${PROJECT}`)
  const defaulted = await json(`(() => {
    const tab = document.querySelector('[role="tab"][data-tab-id="audio"]')
    return tab ? tab.getAttribute('aria-selected') === 'true' : null
  })()`)
  // 沒帶參數時不該跑到有聲去——否則上面那條是碰巧綠的。
  ok('沒帶 ?tab 時還是開在目錄', defaulted === false, String(defaulted))
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
