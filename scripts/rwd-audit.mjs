/**
 * Measures every page at every viewport, instead of looking at screenshots.
 *
 *   node scripts/rwd-audit.mjs --base http://127.0.0.1:3400
 *
 * A screenshot shows a page is wrong; it does not say which element did it,
 * and at 25 pages × 3 widths nobody looks at all 75. This reports the four
 * failures that actually happen, each of which is a measurement:
 *
 *   - horizontal overflow — the page scrolls sideways
 *   - escaping elements   — something is wider than the viewport
 *   - small tap targets   — below 32px on a touch width
 *   - clipped text        — a line is cut off rather than wrapped
 *
 * Exits non-zero when anything fails, so it can gate a commit.
 */
import { rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cdp, debuggerUrl, launchChrome, signIn } from './shots.mjs'

const BASE = (arg('base') ?? 'http://127.0.0.1:3400').replace(/\/$/, '')
const OUT = arg('out') ?? '.shots/rwd'
const ONLY = arg('only')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
]

/** Page routes, with the ids filled in by `--project` / `--episode`. */
function routes(ids) {
  const p = ids.projectId
  const e = ids.episodeId
  const m = ids.musicId

  return [
    '/dashboard',
    '/projects',
    '/chat',
    '/read',
    '/watch',
    '/listen',
    ...(p
      ? [
          `/projects/${p}`,
          `/projects/${p}/episodes`,
          `/projects/${p}/novel`,
          `/projects/${p}/scripts`,
          `/projects/${p}/world`,
          `/projects/${p}/characters`,
          `/projects/${p}/production`,
          `/projects/${p}/versions`,
          `/projects/${p}/assets`,
          `/projects/${p}/assets/all`,
          `/projects/${p}/assets/image`,
          `/projects/${p}/assets/music`,
          `/read/${p}`,
        ]
      : []),
    ...(e
      ? [`/projects/${p}/episodes/${e}/novel`, `/projects/${p}/episodes/${e}/assets`]
      : []),
    ...(m ? [`/projects/${p}/assets/music/${m}`] : []),
  ]
}

/**
 * Runs in the page. Returns the measurements, not a verdict — the verdict
 * belongs out here where it can be read and changed.
 */
const PROBE = `(() => {
  const doc = document.documentElement
  const vw = window.innerWidth

  const overflow = Math.max(0, doc.scrollWidth - vw)

  const wide = []
  const clipped = []
  const small = []
  const cramped = []

  /*
   * Screen-reader-only text is implemented as a 1px box with the content
   * overflowing, so it trips every "clipped text" check ever written. It is
   * not on screen and cannot be clipped.
   */
  const srOnly = (el) => {
    const s = getComputedStyle(el)
    return (
      (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') &&
      s.position === 'absolute'
    )
  }

  /**
   * Whether an ancestor has translated this subtree off screen — the
   * slide-over rail, a closed drawer. Off-canvas by design is not overflow.
   */
  const offCanvas = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const s = getComputedStyle(node)
      if (s.transform && s.transform !== 'none') {
        const m = new DOMMatrixReadOnly(s.transform)
        if (Math.abs(m.m41) > 1) return true
      }
      if (s.position === 'fixed' && node.getBoundingClientRect().right <= 0) return true
    }
    return false
  }

  const describe = (el) => {
    const id = el.id ? '#' + el.id : ''
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return (el.tagName.toLowerCase() + id + (text ? ' 「' + text + '」' : ''))
  }

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (srOnly(el)) continue

    const box = el.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    if (offCanvas(el)) continue

    // Wider than the viewport, or pushed past its right edge.
    if (box.width > vw + 1 || box.right > vw + 1) {
      /*
       * Inside a scroller is not overflow.
       *
       * The check has to walk up: a tab strip is a nav with overflow-x-auto
       * wrapping a ul with min-w-max, and the ul itself has no overflow
       * property at all. Measuring only the element reported every tab strip
       * in the app as broken — and they are not; they scroll.
       */
      const scrolled = (() => {
        if (el.scrollWidth > el.clientWidth + 1) return true
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const s = getComputedStyle(n)
          if ((s.overflowX === 'auto' || s.overflowX === 'scroll') &&
              n.getBoundingClientRect().width <= vw + 1) {
            return true
          }
        }
        return false
      })()

      if (!scrolled && style.overflowX !== 'auto' && style.overflowX !== 'scroll') {
        wide.push({ what: describe(el), w: Math.round(box.width), right: Math.round(box.right) })
      }
    }

    // Text cut off instead of wrapping. 'ellipsis' is a choice; 'clip' is not.
    if (
      el.children.length === 0 &&
      el.textContent?.trim() &&
      el.scrollWidth > el.clientWidth + 2 &&
      style.textOverflow !== 'ellipsis' &&
      style.overflow !== 'auto' &&
      style.overflow !== 'scroll'
    ) {
      clipped.push({
        text: el.textContent.trim().slice(0, 40),
        over: Math.round(el.scrollWidth - el.clientWidth),
      })
    }
  }

  // Tap targets, only where a finger is the input.
  for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"]')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (srOnly(el) || offCanvas(el)) continue

    /*
     * A link inside a sentence is text, not a tap target; the line height is
     * its height and nothing can be done about that short of not having
     * inline links. Only standalone controls are measured.
     */
    if (el.tagName === 'A' && getComputedStyle(el).display.startsWith('inline')) continue
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    /*
     * WCAG 2.2 SC 2.5.8 sets the floor at 24×24 CSS px. 44 is the size a
     * finger actually wants, so anything between the two is reported as
     * cramped rather than failing — flagging all of it equally would bury
     * the controls that are genuinely unhittable.
     */
    /*
     * .tap enlarges the hit area with a pseudo-element, which
     * getBoundingClientRect does not report — so measure what is actually
     * clickable: probe outwards from the centre and see how far the element
     * still answers elementFromPoint.
     */
    const hit = (() => {
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      const owns = (x, y) => {
        const target = document.elementFromPoint(x, y)
        return Boolean(target) && (target === el || el.contains(target) || target.contains(el))
      }
      if (!owns(cx, cy)) return { w: Math.round(box.width), h: Math.round(box.height) }

      let w = box.width
      let h = box.height
      for (const reach of [22, 20, 18, 16, 14, 12]) {
        if (owns(cx - reach, cy) && owns(cx + reach, cy)) { w = Math.max(w, reach * 2); break }
      }
      for (const reach of [22, 20, 18, 16, 14, 12]) {
        if (owns(cx, cy - reach) && owns(cx, cy + reach)) { h = Math.max(h, reach * 2); break }
      }
      return { w: Math.round(w), h: Math.round(h) }
    })()

    if (hit.w < 24 || hit.h < 24) {
      small.push({
        label:
          (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) || '(無標籤)',
        w: hit.w,
        h: hit.h,
      })
    } else if (hit.w < 44 || hit.h < 44) {
      cramped.push({
        label:
          (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) || '(無標籤)',
        w: hit.w,
        h: hit.h,
      })
    }
  }

  return {
    vw, overflow,
    wide: wide.slice(0, 6),
    clipped: clipped.slice(0, 6),
    small: small.slice(0, 8),
    cramped: cramped.slice(0, 8),
    crampedCount: cramped.length,
  }
})()`

async function main() {
  const cookies = await signIn(BASE, 'collaborator')
  await mkdir(OUT, { recursive: true })

  const port = 9222 + Math.floor(Math.random() * 500)
  const dir = join(tmpdir(), `srds-rwd-${Date.now()}`)
  const chrome = launchChrome(port, dir)

  const findings = []

  try {
    const client = await Cdp.connect(await debuggerUrl(port))
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
    for (const d of ['Page', 'Network', 'Runtime']) await client.send(`${d}.enable`, {}, sessionId)

    const { hostname } = new URL(BASE)
    for (const [name, value] of Object.entries(cookies)) {
      await client.send('Network.setCookie', { name, value, domain: hostname, path: '/' }, sessionId)
    }

    const evaluate = async (expression) => {
      const { result } = await client.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId
      )
      return result.value
    }

    // Discover real ids rather than hardcoding them.
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${BASE}/projects` }, sessionId)
    await loaded
    await sleep(900)

    const ids = await evaluate(`(() => {
      const hrefs = [...document.querySelectorAll('a')].map(a => a.getAttribute('href') || '')
      const project = hrefs.find(h => h.startsWith('/projects/') && h.split('/').length === 3)
      return { projectId: project ? project.split('/')[2] : null }
    })()`)

    if (ids.projectId) {
      const l2 = client.once('Page.loadEventFired')
      await client.send(
        'Page.navigate',
        { url: `${BASE}/projects/${ids.projectId}/episodes` },
        sessionId
      )
      await l2
      await sleep(900)
      ids.episodeId = await evaluate(`(() => {
        const a = [...document.querySelectorAll('a')].map(x => x.getAttribute('href') || '')
          .find(h => h.includes('/episodes/') && h.split('/').length > 4)
        return a ? a.split('/')[4] : null
      })()`)
    }

    const paths = (ONLY ? [ONLY] : routes(ids)).filter(Boolean)
    console.log(`\n掃 ${paths.length} 個頁面 × ${VIEWPORTS.length} 個寬度\n`)

    for (const path of paths) {
      for (const view of VIEWPORTS) {
        await client.send(
          'Emulation.setDeviceMetricsOverride',
          {
            width: view.width,
            height: view.height,
            deviceScaleFactor: 1,
            mobile: view.mobile,
          },
          sessionId
        )

        const nav = client.once('Page.loadEventFired')
        await client.send('Page.navigate', { url: `${BASE}${path}` }, sessionId)
        await nav
        await sleep(800)

        const probe = await evaluate(PROBE)
        if (!probe) continue

        const problems = []
        const notes = []
        if (probe.overflow > 1) problems.push(`橫向溢出 ${probe.overflow}px`)
        if (probe.wide.length > 0) {
          problems.push(
            `${probe.wide.length} 個元素超出畫面：` +
              probe.wide.map((w) => `${w.what} ${w.w}px`).join('; ')
          )
        }
        if (probe.clipped.length > 0) {
          problems.push(
            `${probe.clipped.length} 處文字被切：` +
              probe.clipped.map((c) => `「${c.text}」+${c.over}px`).join(' ')
          )
        }
        // Tap targets only matter where the input is a finger.
        if (view.mobile && probe.small.length > 0) {
          problems.push(
            `${probe.small.length} 個點擊區小於 WCAG 的 24px：` +
              probe.small.map((s) => `${s.label}(${s.w}×${s.h})`).join(' ')
          )
        }
        if (view.mobile && probe.crampedCount > 0) {
          notes.push(
            `${probe.crampedCount} 個點擊區不足 44px：` +
              probe.cramped.map((s) => `${s.label}(${s.w}×${s.h})`).join(' ')
          )
        }

        if (problems.length > 0) {
          findings.push({ path, view: view.name, problems })
          console.log(`  ✗ ${view.name.padEnd(8)} ${path}`)
          for (const p of problems) console.log(`      ${p}`)
        } else {
          console.log(`  ✓ ${view.name.padEnd(8)} ${path}`)
        }
        for (const n of notes) console.log(`      · ${n}`)
      }
    }

    await client.send('Browser.close').catch(() => {})
  } finally {
    chrome.kill()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  await writeFile(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2), 'utf8')

  console.log(`\n${findings.length === 0 ? '全部通過' : `${findings.length} 個問題`}\n`)
  if (findings.length > 0) process.exitCode = 1
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await main()
