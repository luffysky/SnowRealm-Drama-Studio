/**
 * 介面切到「繁體」之後，到底有沒有轉，以及有沒有轉壞 (Z172).
 *
 * 量法不是讀 class，也不是讀 DOM 轉換那一支的程式——那一支是改 DOM 的，而測試
 * 跑在 node 環境沒有 jsdom，所以 `tests/chinese.test.ts` 只蓋得到純函式那一
 * 半。這一支補的就是另一半：
 *
 *  1. **轉換真的在跑。** 塞一段簡體文字進畫面，等一帧，讀回來看它變了沒有。
 *     同時這也驗到 MutationObserver（第一次繪製之後才出現的東西要跟著轉）。
 *  2. **寫死的繁體標籤沒有被「校正」。** 側邊欄的「儀表板」不可以變成
 *     「儀錶板」、「小說工作台」不可以變成「小說工作臺」——那是簡 → 繁 防護
 *     唯一要擋的事，而它擋的是真的錯字，不是異體字之爭。
 *  4. **閱讀器的「繁體」選得到、而且存得住。** `ReaderSettings.script` 本來只有
 *     兩個值，所以 Z172 做出來的簡 → 繁 在正文上一次都走不到（Z174）。這一條
 *     量的是三顆按鈕都在、按下去會存、而且**重新載入之後還在**——`traditional`
 *     本來會在讀取時被默默丟掉，所以「按得下去」不足以證明它修好了。
 *
 *  3. **`data-script-keep` 的子樹真的不被轉。** 繁簡切換鍵就靠這個標記：
 *     「简体」那顆按鈕上的字沒有繁體獨有字，所以 `chinese.ts` 的防護放它過
 *     去，cn→tw 會把它變成「簡體」——兩顆按鈕都寫繁體，沒有人看得出哪一邊是
 *     哪一邊。擋它的是這個標記，不是那道防護。
 *
 *     （檔頭原本就寫著這一條，而 body 裡沒有對應的 check——子代理審出來的。
 *     現在量的是機制本身：塞一段簡體進一個標了 `data-script-keep` 的子樹，
 *     它必須原樣不動。切換鍵本身在收起來的選單裡，量不到。）
 *
 * ## 第一次跑九條全不過，而原因不在這個功能 (Z173)
 *
 * `base` 用 `127.0.0.1` 的時候，Next 16 會把 `/_next/hmr` 跟用戶端 chunk 當跨
 * 來源擋掉，於是**整頁不會 hydrate**——伺服器算好的 HTML 照樣顯示，所以看起來
 * 一切正常，而 effect 不跑、動態 import 不載、繁簡不轉。`scripts/` 底下**21 支**
 * 會開瀏覽器的腳本預設全部連 `127.0.0.1`（port 有 3400／3401／3402／3404 四
 * 種，而 `allowedDevOrigins` 只比對主機名，跟 port 無關），所以這件事不只影響
 * 這一支。
 *
 * 修在 `next.config.ts` 的 `allowedDevOrigins`，不在這裡——改一行勝過改 18 個
 * 檔案。這一支照樣用 `127.0.0.1`，跟其他腳本一致；它跑得過，就表示那個設定還
 * 在。
 *
 *   node scripts/probe-script-mode.mjs
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
/** 第一個位置參數是作品 id；沒給就跳過閱讀器那一段。 */
const projectId = process.argv[2] ?? ''
const cookies = await signIn(base, 'collaborator')
const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-script-${Date.now()}`))

let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures += 1
}

try {
  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Runtime.enable', {}, sessionId)
  client.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'warning') console.log('    [console]', p.args.map((x) => x.value ?? x.description ?? x.type).join(' ').slice(0, 300)) })
  client.on('Runtime.exceptionThrown', (p) => console.log('    [throw]', (p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 400)))
  const { hostname } = new URL(base)
  for (const [n, v] of Object.entries(cookies)) {
    await client.send('Network.setCookie', { name: n, value: v, domain: hostname, path: '/' }, sessionId)
  }
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId
  )

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

  const go = async (path) => {
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}${path}` }, sessionId)
    await loaded
    // 字典是動態載入的，而轉換要等它到。
    await ev('new Promise((r) => setTimeout(r, 2500))')
  }

  const setMode = async (mode) => {
    await ev(`localStorage.setItem('srds.ui.script.v1', ${JSON.stringify(mode)})`)
  }

  /**
   * 塞一段簡體進畫面，等兩帧，讀回來.
   *
   * 兩帧是因為轉換自己就排在一個 requestAnimationFrame 裡（同一帧的每一筆變動
   * 累積起來一次處理）。
   */
  const inject = async (text, attribute = '') => {
    return ev(`(async () => {
      const probe = document.createElement('p')
      probe.id = 'srds-probe'
      ${attribute ? `probe.setAttribute(${JSON.stringify(attribute)}, '')` : ''}
      probe.textContent = ${JSON.stringify(text)}
      document.body.appendChild(probe)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 200))
      const out = document.getElementById('srds-probe').textContent
      document.getElementById('srds-probe').remove()
      return out
    })()`)
  }

  const bodyText = () => ev('document.body.innerText')

  /* ------------------------------------------------------------- 繁體 */

  await go('/dashboard')
  await setMode('traditional')
  await go('/dashboard')

  console.log('\n繁體模式')
  const tw = await bodyText()
  check((await inject('头发乱了')) === '頭髮亂了', '後來才出現的簡體文字會被轉成繁體')
  check(!tw.includes('儀錶板'), '「儀表板」沒有被改成「儀錶板」')
  check(!tw.includes('工作臺'), '「工作台」沒有被改成「工作臺」')
  check(!tw.includes('隻'), '沒有任何「只」被改成「隻」')
  check(!tw.includes('瞭性別') && !tw.includes('隻讀'), '沒有「說明瞭」「隻讀」這種錯字')
  check(
    (await inject('简体', 'data-script-keep')) === '简体',
    'data-script-keep 的子樹原樣不動（切換鍵靠它）'
  )
  check((await inject('简体')) === '簡體', '同一段字沒有標記就會被轉（證明上一條不是巧合）')

  /* ------------------------------------------------------------- 简体 */

  await setMode('simplified')
  await go('/dashboard')

  console.log('\n简体模式')
  const cn = await bodyText()
  check((await inject('頭髮亂了')) === '头发乱了', '後來才出現的繁體文字會被轉成簡體')
  check(cn.includes('仪表板'), '介面標籤轉成簡體了')
  check(cn.includes('AI 短剧制作与发行平台'), '詞彙層級的轉換是對的（制作、发行）')

  /* ----------------------------------------------------- 閱讀器 (Z174) */

  if (!projectId) {
    console.log('\n閱讀器：沒給作品 id，跳過（用法：node scripts/probe-script-mode.mjs <projectId>）')
  } else {
    console.log('\n閱讀器')

    const readerKey = 'srds.reader.settings.v2'
    const path = `/read/${projectId}/text`

    await go(path)

    /*
     * 字形選單在「閱讀設定」面板裡，要先打開.
     *
     * 用文字找那顆按鈕不可靠——介面本身會被繁簡轉換改寫（簡體模式下它是「阅
     * 读设置」）。所以按 `Settings2` 那個 svg 的 class 找它的按鈕，那不受文字
     * 轉換影響。
     */
    const opened = await ev(`(() => {
      const icon = document.querySelector('button svg.lucide-settings-2, button svg.lucide-settings2')
      const button = icon?.closest('button')
        ?? [...document.querySelectorAll('button')].find((b) => /設定|设置/.test(b.textContent ?? ''))
      if (!button) return false
      button.click()
      return true
    })()`)
    check(opened === true, '打得開閱讀設定面板')
    await ev('new Promise((r) => setTimeout(r, 400))')

    const labels = await ev(
      `[...document.querySelectorAll('[role="radio"]')].map((b) => b.textContent.trim())`
    )
    check(
      Array.isArray(labels) && ['原文', '简体', '繁體'].every((l) => labels.includes(l)),
      '三顆字形按鈕都在',
      JSON.stringify(labels)
    )

    /*
     * 存得住，不只是按得下去.
     *
     * `loadReaderSettings` 本來把認不出來的值退回預設，而 `traditional` 就在
     * 「認不出來」裡面——所以舊版就算硬塞也活不過一次重新載入。
     */
    await ev(
      `(() => {
        const saved = JSON.parse(localStorage.getItem(${JSON.stringify(readerKey)}) ?? '{}')
        saved.script = 'traditional'
        localStorage.setItem(${JSON.stringify(readerKey)}, JSON.stringify(saved))
      })()`
    )
    await go(path)
    await ev(`(() => {
      const icon = document.querySelector('button svg.lucide-settings-2, button svg.lucide-settings2')
      const button = icon?.closest('button')
        ?? [...document.querySelectorAll('button')].find((b) => /設定|设置/.test(b.textContent ?? ''))
      button?.click()
    })()`)
    await ev('new Promise((r) => setTimeout(r, 400))')

    const picked = await ev(
      `[...document.querySelectorAll('[role="radio"]')]
         .filter((b) => b.getAttribute('aria-checked') === 'true')
         .map((b) => b.textContent.trim())`
    )
    check(
      Array.isArray(picked) && picked.includes('繁體'),
      '選了繁體，重新載入之後還是繁體',
      JSON.stringify(picked)
    )

    /*
     * 正文真的走了那一條轉換.
     *
     * 這本稿子目前是繁體的，所以「繁體」在它身上是零動作——那證明不了接線。
     * 改成量**另一個方向**：切到简体，同一段正文必須變成簡體。走的是同一支
     * `useScriptConverter`，所以它會轉就表示線接上了。
     */
    const proseOf = () =>
      ev(`(document.querySelector('[data-script-own].reader-prose p')?.textContent ?? '').slice(0, 40)`)

    const asTraditional = await proseOf()

    await ev(
      `(() => {
        const saved = JSON.parse(localStorage.getItem(${JSON.stringify(readerKey)}) ?? '{}')
        saved.script = 'simplified'
        localStorage.setItem(${JSON.stringify(readerKey)}, JSON.stringify(saved))
      })()`
    )
    await go(path)
    const asSimplified = await proseOf()

    check(
      asTraditional.length > 0 && asSimplified.length > 0,
      '抓到正文了',
      `${asTraditional.slice(0, 16)} / ${asSimplified.slice(0, 16)}`
    )
    check(
      asTraditional !== asSimplified,
      '正文會跟著字形設定變（接線是通的）',
      `繁 ${asTraditional.slice(0, 14)} → 簡 ${asSimplified.slice(0, 14)}`
    )

    /*
     * 翻頁導覽列不再是「誰都不轉」(Z174).
     *
     * 它本來在 `data-script-own` 裡面，所以介面那一份跳過它、正文那一份沒碰
     * 它。標記縮到 `<article>` 之後它歸介面管，而介面預設是简体。
     *
     * **第一版這條斷言是空的**：我量的是捲動模式，而那時導覽列寫「上一章／
     * 第 N / M 章／下一章」——`上`/`一`/`章`/`第` 繁簡同形，所以不管接線有沒
     * 有通，那串字都長一樣。改成先切到橫向分頁模式（`horizontal`）：那時候它寫「上一頁／下一
     * 頁」，而 `頁` → `页` 是真的會變的。
     *
     * 這跟 Z171、Z172 抓到的空測試是同一個失敗模式：斷言跑得過，但它跑過的
     * 原因跟我以為的不是同一件事。
     */
    await ev(
      `(() => {
        const saved = JSON.parse(localStorage.getItem(${JSON.stringify(readerKey)}) ?? '{}')
        saved.mode = 'horizontal'
        localStorage.setItem(${JSON.stringify(readerKey)}, JSON.stringify(saved))
      })()`
    )
    await go(path)

    const nav = String(
      await ev(
        `(document.querySelector('.reader-surface nav')?.innerText ?? [...document.querySelectorAll('nav')].at(-1)?.innerText ?? '')`
      )
    )
    check(nav.includes('页'), '翻頁導覽列跟著介面設定轉成簡體了', JSON.stringify(nav.replace(/\s+/g, ' ').slice(0, 36)))
    check(!nav.includes('頁'), '導覽列裡沒有殘留的繁體「頁」')
  }

  console.log(`\n${failures === 0 ? '✓ 全部通過' : `✗ ${failures} 條沒過`}`)
} finally {
  chrome.kill()
}

process.exit(failures === 0 ? 0 : 1)
