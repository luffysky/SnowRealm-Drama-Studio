/**
 * 小說編輯器的尋找與取代，在真的瀏覽器裡真的按一次 (Z179).
 *
 * **寫入全部擋掉。** 這一頁 2.5 秒就自動存檔，而它編輯的是暖寶真的稿子。所以
 * 進頁之後第一件事是把 `window.fetch` 包起來，任何對 `chapters` 的
 * PATCH/POST/DELETE 都不送出去、只記一筆。於是取代全部留在瀏覽器記憶體裡，資
 * 料庫一個字都不會動——而且「它有沒有想存」本身也變成一條可以斷言的事（搜尋
 * 不該想存，取代該想存）。
 *
 * 用法：node scripts/probe-find-replace.mjs
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
const EPISODE = 'a454260b-7e01-449f-9bee-fa6d966be48c'

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
const chrome = launchChrome(port, join(tmpdir(), `srds-fr-${Date.now()}`))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Network.enable', {}, sessionId)
  await client.send('Runtime.enable', {}, sessionId)
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

  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId
  )

  const loaded = client.once('Page.loadEventFired')
  await client.send(
    'Page.navigate',
    { url: `${base}/projects/${PROJECT}/episodes/${EPISODE}/novel` },
    sessionId
  )
  await loaded
  await wait(3500)

  /* ---- 1. 把寫入擋掉，在做任何事之前 ------------------------------------ */
  const guard = await ev(`(() => {
    if (window.__frGuard) return 'already'
    window.__frBlocked = []
    const real = window.fetch
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const method = ((init && init.method) || 'GET').toUpperCase()
      if (method !== 'GET' && /\\/chapters\\//.test(url)) {
        window.__frBlocked.push(method + ' ' + url)
        return Promise.resolve(new Response(
          JSON.stringify({ error: { message: 'probe 擋住了寫入' } }),
          { status: 503, headers: { 'content-type': 'application/json' } }
        ))
      }
      return real(input, init)
    }
    window.__frGuard = true
    return 'installed'
  })()`)
  ok('寫入攔截器已安裝（資料庫不會被動到）', guard === 'installed' || guard === 'already', guard)

  /* ---- 2. 編輯器掛起來了嗎 --------------------------------------------- */
  const m = await json(`(() => {
    const pm = document.querySelector('.ProseMirror')
    return {
      shell: !!document.querySelector('.editor-shell'),
      prosemirror: !!pm,
      chars: pm ? (pm.innerText || '').length : 0,
      loading: /編輯器載入中/.test(document.body.innerText || ''),
    }
  })()`)
  ok('編輯器掛載完成（不是停在「載入中」）', m.prosemirror && !m.loading, JSON.stringify(m))
  ok('正文有字', m.chars > 500, `${m.chars} 字`)

  /* ---- 3. 工具列按鈕 + Ctrl+F ------------------------------------------ */
  const button = await ev(`(() => {
    const b = [...document.querySelectorAll('.editor-shell button')]
      .find((x) => /尋找與取代/.test(x.getAttribute('aria-label') || ''))
    return b ? (b.getAttribute('aria-label') || 'found') : 'missing'
  })()`)
  ok('工具列有「尋找與取代」按鈕', button !== 'missing', button)

  await ev(`document.querySelector('.ProseMirror').focus()`)
  await client.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 },
    sessionId
  )
  await wait(500)
  ok(
    'Ctrl+F 開啟面板',
    (await ev(`!!document.querySelector('.editor-shell input[aria-label="尋找"]')`)) === true
  )

  /* ---- 4. 面板上該有的東西 --------------------------------------------- */
  const p = await json(`(() => {
    const shell = document.querySelector('.editor-shell')
    const labels = [...shell.querySelectorAll('input,button')]
      .map((x) => x.getAttribute('aria-label') || (x.innerText || '').trim())
      .filter(Boolean)
    return {
      needle: !!shell.querySelector('input[aria-label="尋找"]'),
      replacement: !!shell.querySelector('input[aria-label="取代為"]'),
      prev: labels.includes('上一個'),
      next: labels.includes('下一個'),
      replace: labels.includes('取代'),
      replaceAll: labels.some((l) => l.includes('全部取代')),
      caseToggle: labels.includes('區分大小寫'),
      foldToggle: labels.includes('繁簡通用'),
      foldOnByDefault:
        shell.querySelector('[aria-label="繁簡通用"]')?.getAttribute('aria-pressed') === 'true',
    }
  })()`)
  ok(
    '面板七件東西都在（尋找／取代為／上下／取代／全部取代／繁簡通用／Aa）',
    p.needle && p.replacement && p.prev && p.next && p.replace && p.replaceAll && p.caseToggle &&
      p.foldToggle,
    JSON.stringify(p)
  )
  ok('繁簡通用預設開著', p.foldOnByDefault === true)

  /* ---- 5. 挑一個真的在正文裡、而且出現多次的詞 ------------------------- */
  const picked = await json(`(() => {
    const text = (document.querySelector('.ProseMirror').innerText || '')
    const counts = new Map()
    for (let i = 0; i + 2 <= text.length; i += 1) {
      const pair = text.slice(i, i + 2)
      if (!/^[\\u4e00-\\u9fff]{2}$/.test(pair)) continue
      counts.set(pair, (counts.get(pair) || 0) + 1)
    }
    let best = null
    for (const [pair, n] of counts) if (!best || n > best[1]) best = [pair, n]
    return { needle: best ? best[0] : null, occurrences: best ? best[1] : 0, total: text.length }
  })()`)
  const { needle, occurrences } = picked
  ok('找到一個出現多次的詞當測試標的', !!needle && occurrences >= 3, JSON.stringify(picked))

  const typeInto = async (label, value) => {
    await ev(`(() => {
      const el = document.querySelector('.editor-shell input[aria-label="${label}"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await wait(450)
  }
  const counter = () =>
    ev(`(() => {
      const s = document.querySelector('.editor-shell span[aria-live="polite"]')
      return s ? (s.innerText || '').trim() : 'none'
    })()`)
  const clickLabel = async (text) => {
    const hit = await ev(`(() => {
      const b = [...document.querySelectorAll('.editor-shell button')]
        .find((x) => (x.getAttribute('aria-label') || '').trim() === ${JSON.stringify(text)}
                  || (x.innerText || '').trim() === ${JSON.stringify(text)})
      if (!b) return 'missing'
      if (b.disabled) return 'disabled'
      b.click()
      return 'clicked'
    })()`)
    await wait(500)
    return hit
  }
  const hits = () =>
    json(`(() => {
      const all = document.querySelectorAll('.ProseMirror .search-hit')
      const on = document.querySelectorAll('.ProseMirror .search-hit-on')
      return {
        painted: all.length,
        current: on.length,
        currentText: on[0] ? on[0].textContent : null,
        firstText: all[0] ? all[0].textContent : null,
      }
    })()`)

  /* ---- 6. 計數對不對 ---------------------------------------------------- */
  await typeInto('尋找', needle)
  const count1 = await counter()
  const reported = Number((count1.split('/')[1] || '0').trim())
  ok(
    `輸入「${needle}」後計數符合正文裡的次數`,
    reported === occurrences,
    `面板 ${count1}，正文數到 ${occurrences}`
  )

  /* ---- 7. 看得見嗎——這一條是 Z179 的重點 ------------------------------ */
  const painted = await hits()
  ok(
    '每一個相符處都畫在正文上了',
    painted.painted === occurrences,
    `畫了 ${painted.painted} 個，應為 ${occurrences}`
  )
  ok(
    '當前那一個長得不一樣（否則 69 個之中看不出哪個是「1」）',
    painted.current === 1 && painted.currentText === needle,
    JSON.stringify(painted)
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
  await shoot('find-replace-desktop.png')

  /* ---- 8. 只是搜尋，不該把稿子改髒 ------------------------------------- */
  await wait(3200) // 比自動存檔的 2.5 秒久
  const afterSearch = await json(`(window.__frBlocked || [])`)
  ok(
    '光是搜尋不會觸發自動存檔（高亮不是一次編輯）',
    afterSearch.length === 0,
    JSON.stringify(afterSearch)
  )

  /* ---- 9. 上一個／下一個 ------------------------------------------------ */
  await clickLabel('下一個')
  const count2 = await counter()
  const moved = await hits()
  ok('「下一個」往前走一格，而高亮跟著走', count2.startsWith('2 /') && moved.current === 1,
    `${count1} → ${count2}，${JSON.stringify(moved)}`)

  /* ---- 10. 取代一個 ----------------------------------------------------- */
  const MARK = '〇〇'
  await typeInto('取代為', MARK)
  await clickLabel('取代')
  const one = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    return { marks: (t.match(/〇〇/g) || []).length, len: t.length }
  })()`)
  ok('「取代」換掉了一個', one.marks === 1, JSON.stringify(one))

  /* ---- 11. 全部取代 ---------------------------------------------------- */
  await clickLabel('全部取代')
  const all = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    return { marks: (t.match(/〇〇/g) || []).length, left: (t.match(/${needle}/g) || []).length }
  })()`)
  ok(
    '「全部取代」把剩下的都換掉，而且沒有漏字或錯位',
    all.marks === occurrences && all.left === 0,
    `${JSON.stringify(all)}，應為 marks=${occurrences} left=0`
  )

  /* ---- 12. 取代過了才該想存檔 ------------------------------------------ */
  await wait(3200)
  const afterReplace = await json(`(window.__frBlocked || [])`)
  ok(
    '取代之後確實有嘗試存檔（而且被 probe 擋下來了）',
    afterReplace.length > 0 && afterReplace.every((r) => r.startsWith('PATCH')),
    JSON.stringify(afterReplace)
  )

  /* ---- 13. 復原回得去嗎 ------------------------------------------------- */
  const undoTimes = async (n) => {
    await ev(`(() => { document.querySelector('.ProseMirror').focus(); return true })()`)
    for (let i = 0; i < n; i += 1) {
      await client.send(
        'Input.dispatchKeyEvent',
        { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 },
        sessionId
      )
    }
    await wait(800)
  }
  await undoTimes(60)
  const u = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    return { marks: (t.match(/〇〇/g) || []).length, back: (t.match(/${needle}/g) || []).length }
  })()`)
  ok('復原（Ctrl+Z）可以一路退回原文', u.marks === 0 && u.back === occurrences, JSON.stringify(u))

  /* ---- 14. 取代字串裡的 < 與 &：照字面進去 ------------------------------ */
  await typeInto('尋找', needle)
  await typeInto('取代為', 'a<b & c')
  await clickLabel('取代')
  const h = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    return { literal: t.includes('a<b & c'), lone: (t.match(/a(?!<b)/g) || []).length }
  })()`)
  ok('取代字串裡的 < 與 & 照字面進去，沒有被當成標記吃掉', h.literal === true, JSON.stringify(h))

  /* ---- 15. 取代成空字串 = 刪掉 ----------------------------------------- */
  await undoTimes(20)
  await typeInto('尋找', needle)
  await typeInto('取代為', '')
  const lenBefore = await ev(`(document.querySelector('.ProseMirror').innerText || '').length`)
  await clickLabel('全部取代')
  const e = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    return { left: (t.match(/${needle}/g) || []).length, len: t.length }
  })()`)
  ok(
    '取代為空字串＝刪除全部相符處',
    e.left === 0 && e.len === lenBefore - occurrences * needle.length,
    `${JSON.stringify(e)}，原長 ${lenBefore}，應少 ${occurrences * needle.length} 字`
  )
  await undoTimes(20)

  /* ---- 16. 繁簡通用：打繁體找得到簡體原文 ------------------------------ */
  const foldCase = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    // 找一個在正文裡、而且繁簡寫法不同的詞。
    const pairs = [['这', '這'], ['说', '說'], ['来', '來'], ['过', '過'], ['没', '沒'],
                   ['个', '個'], ['时', '時'], ['后', '後'], ['里', '裡'], ['头', '頭']]
    for (const [cn, tw] of pairs) {
      const n = (t.split(cn).length - 1)
      if (n >= 3) return { cn, tw, occurrences: n }
    }
    return null
  })()`)
  if (!foldCase) {
    ok('正文裡找得到一個繁簡寫法不同的字當標的', false, '找不到')
  } else {
    await typeInto('取代為', '')
    await typeInto('尋找', foldCase.tw)
    const folded = await counter()
    ok(
      `繁簡通用：打繁體「${foldCase.tw}」找得到簡體原文「${foldCase.cn}」`,
      Number((folded.split('/')[1] || '0').trim()) === foldCase.occurrences,
      `面板 ${folded}，正文有 ${foldCase.occurrences} 個「${foldCase.cn}」`
    )

    // 關掉就該找不到——否則上面那一條是白測的。
    await clickLabel('繁簡通用')
    const exact = await counter()
    ok(
      '關掉繁簡通用就找不到（證明上一條不是碰巧綠的）',
      Number((exact.split('/')[1] || '0').trim()) === 0,
      `面板 ${exact}`
    )
    await clickLabel('繁簡通用')
  }

  /* ---- 17. 面板開著時在正文裡打字，游標不准被搶走 ---------------------- */
  /*
   * 「文件一變就重算」會讓捲動那個 effect 每一次按鍵都跑一遍。少了焦點判斷，
   * 每打一個字游標就被拉回相符處——於是第二個字打到別的地方去。這一條量的就
   * 是這件事：兩個字必須黏在一起。
   */
  await typeInto('尋找', needle)
  await ev(`(() => {
    const pm = document.querySelector('.ProseMirror')
    pm.focus()
    const end = pm.ownerDocument.createRange()
    end.selectNodeContents(pm.lastElementChild || pm)
    end.collapse(false)
    const sel = pm.ownerDocument.getSelection()
    sel.removeAllRanges()
    sel.addRange(end)
    return true
  })()`)
  await wait(300)
  for (const [key, code, vk] of [['A', 'KeyA', 65], ['B', 'KeyB', 66]]) {
    await client.send(
      'Input.dispatchKeyEvent',
      { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key },
      sessionId
    )
    await client.send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key, code, windowsVirtualKeyCode: vk },
      sessionId
    )
    await wait(350)
  }
  const typed = await json(`(() => {
    const t = document.querySelector('.ProseMirror').innerText || ''
    return { together: t.includes('AB'), a: (t.match(/A/g) || []).length, b: (t.match(/B/g) || []).length }
  })()`)
  ok(
    '面板開著時在正文裡打字，游標不會被拉回相符處（兩個字黏在一起）',
    typed.together === true && typed.a === 1 && typed.b === 1,
    JSON.stringify(typed)
  )
  await undoTimes(10)

  /* ---- 18. 關掉面板，高亮要收乾淨 -------------------------------------- */
  await typeInto('尋找', needle)
  const beforeClose = await hits()
  await clickLabel('關閉')
  const afterClose = await hits()
  ok(
    '關掉面板之後正文上不留任何高亮',
    beforeClose.painted > 0 && afterClose.painted === 0,
    `關閉前 ${beforeClose.painted}，關閉後 ${afterClose.painted}`
  )

  /* ---- 19. 手機寬度：這一列有八個東西，會不會把頁面撐寬 ---------------- */
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    sessionId
  )
  await wait(900)
  await clickLabel('尋找與取代（Ctrl+F）')
  await typeInto('尋找', needle)
  await wait(600)
  const phone = await json(`(() => {
    const shell = document.querySelector('.editor-shell')
    const panel = shell ? shell.querySelector('input[aria-label="尋找"]') : null
    return {
      open: !!panel,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      /*
       * 同一列的元素高度不同（輸入框 28px、分隔線 16px），所以 top 會差幾個
       * 像素。分桶取整會在桶邊界把同一列切成兩列——實測 664 與 671 就這樣變
       * 成兩列。所以用群聚：跟前一列差超過半個列高才算換列。
       */
      panelRows: panel
        ? (() => {
            const tops = [...panel.closest('div').children]
              .map((c) => c.getBoundingClientRect().top)
              .sort((a, b) => a - b)
            let rows = 0
            let last = -Infinity
            for (const top of tops) {
              if (top - last > 14) {
                rows += 1
                last = top
              }
            }
            return rows
          })()
        : 0,
      panelHeight: panel ? Math.round(panel.closest('div').getBoundingClientRect().height) : 0,
    }
  })()`)
  ok('面板在 390px 下不會把整頁撐寬', phone.open && phone.pageOverflow === 0, JSON.stringify(phone))
  ok(
    '面板在 390px 下最多三列（再多就把正文擠出畫面了）',
    phone.panelRows <= 3 && phone.panelHeight <= 120,
    `${phone.panelRows} 列、${phone.panelHeight}px`
  )
  await shoot('find-replace-phone.png')

  console.log(`  ·  被擋下的寫入共 ${(await json(`(window.__frBlocked||[]).length`))} 次`)
} finally {
  chrome.kill()
}

console.log(`\n  ${pass} 通過 / ${fail} 失敗`)
process.exit(fail > 0 ? 1 : 0)
