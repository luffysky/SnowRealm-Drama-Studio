/**
 * Screenshots the running app at phone, tablet and desktop widths.
 *
 *   node scripts/shots.mjs --base http://127.0.0.1:3400 --out .shots /dashboard /projects
 *
 * Why this exists: "手機也要順" cannot be verified by reading Tailwind class
 * names. This drives a real Chrome over the DevTools Protocol, signs in the way
 * a browser does (CSRF cookie, then the login API), and writes a full-page PNG
 * per viewport.
 *
 * No Puppeteer: CDP is a WebSocket protocol and Node ships a WebSocket client,
 * so this needs nothing beyond the Chrome already installed.
 *
 * Credentials come from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD. They are never
 * logged.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, scale: 2, mobile: true },
  { name: 'tablet', width: 820, height: 1180, scale: 2, mobile: true },
  { name: 'desktop', width: 1440, height: 900, scale: 1, mobile: false },
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

/**
 * Positional arguments: the paths to shoot.
 *
 * A leading slash is optional — Git Bash on Windows rewrites `/login` into a
 * Windows path before Node ever sees it, so `login` is the safer spelling and
 * both are accepted.
 */
function paths() {
  const out = []
  for (let i = 2; i < process.argv.length; i += 1) {
    const value = process.argv[i]
    if (value.startsWith('--')) {
      i += 1
      continue
    }
    out.push(value.startsWith('/') ? value : `/${value}`)
  }
  return out.length > 0 ? out : ['/dashboard']
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                     */
/* -------------------------------------------------------------------------- */

function parseSetCookie(headers) {
  const jar = {}
  for (const line of headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';')
    const index = pair.indexOf('=')
    if (index > 0) jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
  }
  return jar
}

async function signIn(base) {
  const email = process.env.SEED_OWNER_EMAIL
  const password = process.env.SEED_OWNER_PASSWORD
  if (!email || !password) {
    throw new Error('需要 SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD（讀自 .env.local）')
  }

  const first = await fetch(`${base}/login`, { redirect: 'manual' })
  const jar = parseSetCookie(first.headers)
  const csrf = jar.srds_csrf
  if (!csrf) throw new Error('伺服器沒有發出 srds_csrf cookie')

  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      origin: base,
      cookie: Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new Error(`登入失敗 HTTP ${response.status}：${await response.text()}`)
  }

  return { ...jar, ...parseSetCookie(response.headers) }
}

/* -------------------------------------------------------------------------- */
/* Chrome DevTools Protocol                                                    */
/* -------------------------------------------------------------------------- */

function launchChrome(port, userDataDir) {
  const binary = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!binary) throw new Error('找不到 Chrome 或 Edge')

  const child = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )
  child.unref()
  return child
}

async function debuggerUrl(port) {
  // Chrome needs a moment to open the port; retry rather than sleep blindly.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      const body = await response.json()
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Chrome 偵錯埠沒有開起來')
}

/** Minimal CDP client over the built-in WebSocket. */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, method } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
        return
      }
      for (const handler of this.listeners.get(message.method) ?? []) handler(message.params)
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('CDP 連線失敗')), { once: true })
    })
    return new Cdp(socket)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }

  on(method, handler) {
    const existing = this.listeners.get(method) ?? []
    existing.push(handler)
    this.listeners.set(method, existing)
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        const list = this.listeners.get(method) ?? []
        this.listeners.set(
          method,
          list.filter((h) => h !== handler)
        )
        resolve(params)
      }
      this.on(method, handler)
    })
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  const { loadEnv } = await import('../src/lib/load-env.js').catch(() => ({ loadEnv: null }))
  if (loadEnv) loadEnv()
  else {
    // The library is TypeScript; fall back to a minimal .env.local reader.
    const { readFileSync } = await import('node:fs')
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
    }
  }

  const base = (arg('base', 'http://127.0.0.1:3400') ?? '').replace(/\/$/, '')
  const outDir = arg('out', '.shots')
  const targets = paths()

  const cookies = await signIn(base)
  console.log('  已登入\n')

  await mkdir(outDir, { recursive: true })

  const port = 9222 + Math.floor(Math.random() * 500)
  const userDataDir = join(tmpdir(), `srds-shots-${Date.now()}`)
  const chrome = launchChrome(port, userDataDir)

  try {
    const client = await Cdp.connect(await debuggerUrl(port))
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })

    await client.send('Page.enable', {}, sessionId)
    await client.send('Network.enable', {}, sessionId)

    const { hostname } = new URL(base)
    for (const [name, value] of Object.entries(cookies)) {
      await client.send(
        'Network.setCookie',
        { name, value, domain: hostname, path: '/' },
        sessionId
      )
    }

    for (const path of targets) {
      for (const view of VIEWPORTS) {
        await client.send(
          'Emulation.setDeviceMetricsOverride',
          {
            width: view.width,
            height: view.height,
            deviceScaleFactor: view.scale,
            mobile: view.mobile,
          },
          sessionId
        )

        const target = `${base}${path}`
        if (process.env.SHOTS_DEBUG) console.log('  navigate', JSON.stringify(target), 'session', sessionId)
        const loaded = client.once('Page.loadEventFired')
        await client.send('Page.navigate', { url: target }, sessionId)
        await loaded
        // Let fonts settle and any entry animation finish.
        await new Promise((resolve) => setTimeout(resolve, 700))

        const { data } = await client.send(
          'Page.captureScreenshot',
          { format: 'png', captureBeyondViewport: true },
          sessionId
        )

        const slug = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'
        const file = join(outDir, `${slug}.${view.name}.png`)
        await writeFile(file, Buffer.from(data, 'base64'))
        console.log(`  ${file}`)
      }
    }

    await client.send('Browser.close').catch(() => {})
  } finally {
    chrome.kill()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
