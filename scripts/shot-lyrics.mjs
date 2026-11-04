/**
 * 歌詞真的跟著歌走嗎 (Z125).
 *
 * Writes a throwaway four-line LRC onto a real track, plays it, samples which
 * line is highlighted at several points, then **clears the lyrics back to
 * empty in the same run**. Both tracks had none before, so restoring is exact.
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
const [projectId, assetId] = process.argv.slice(2)
const LRC = ['[00:02.00]測試第一句', '[00:06.00]測試第二句', '[00:10.00]測試第三句', '[00:14.00]測試第四句'].join('\n')

const cookies = await signIn(base, 'collaborator')
const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
await mkdir('.shots', { recursive: true })

async function putLyrics(text) {
  const response = await fetch(`${base}/api/projects/${projectId}/assets/music/${assetId}/lyrics`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: cookieHeader, 'x-csrf-token': cookies.srds_csrf, origin: base },
    body: JSON.stringify({ lyrics: text }),
  })
  if (!response.ok) throw new Error(`PUT ${response.status}: ${await response.text()}`)
}

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = launchChrome(port, join(tmpdir(), `srds-lyr-${Date.now()}`))

try {
  await putLyrics(LRC)
  console.log('  已寫入測試歌詞')

  const client = await Cdp.connect(await debuggerUrl(port))
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Network.enable', {}, sessionId)
  const { hostname } = new URL(base)
  for (const [name, value] of Object.entries(cookies)) {
    await client.send('Network.setCookie', { name, value, domain: hostname, path: '/' }, sessionId)
  }

  const ev = async (e) => {
    const { result, exceptionDetails } = await client.send(
      'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId)
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  for (const [w, h, label, mobile] of [[1440, 900, 'desktop', false], [390, 844, 'phone', true]]) {
    await client.send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId)
    const loaded = client.once('Page.loadEventFired')
    await client.send('Page.navigate', { url: `${base}/listen` }, sessionId)
    await loaded
    await new Promise((r) => setTimeout(r, 1500))

    // Pick the track whose lyrics we wrote, then drive the audio element.
    const picked = await ev(`(() => {
      const row = [...document.querySelectorAll('button, li')]
        .find((n) => (n.innerText || '').includes(${JSON.stringify(process.argv[4] ?? '')}))
      if (row) row.click()
      return !!row
    })()`)

    const report = []
    for (const at of [0, 3, 7, 11, 15]) {
      await ev(`(() => {
        const a = document.querySelector('audio')
        if (!a) return 'no audio'
        a.currentTime = ${at}
        a.dispatchEvent(new Event('timeupdate'))
        return 'ok'
      })()`)
      await new Promise((r) => setTimeout(r, 350))

      const active = await ev(`(() => {
        const hit = [...document.querySelectorAll('[data-line]')]
          .find((n) => n.querySelector('button')?.className.includes('bg-accent-600/20'))
        return hit ? hit.querySelector('button').innerText.trim() : '(沒有highlight)'
      })()`)
      report.push(`${at}s→${active}`)
    }
    console.log(`  [${label}] 選到曲目:${picked}  ${report.join('  ')}`)

    const overflow = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    console.log(`  [${label}] 橫向溢出 ${overflow}px`)

    const { data } = await client.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true }, sessionId)
    await writeFile(join('.shots', `lyrics-${label}.png`), Buffer.from(data, 'base64'))
  }
} finally {
  try {
    await putLyrics('')
    console.log('  已清回空白（原本就是空的）')
  } catch (cause) {
    console.log('  !! 清不掉，請手動清：', cause.message)
  }
  chrome.kill()
}
