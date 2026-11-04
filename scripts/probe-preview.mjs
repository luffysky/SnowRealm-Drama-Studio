/**
 * 試聽端點真的會合成嗎 (Z140).
 *
 * 介面上那顆鈕按得動不代表後面接通了。這支用真的 session 打一次，看回來的
 * 是不是一段播得出來的 MP3，而且**換個風格長度會不一樣**——長度不變就是
 * 風格沒有送到。
 */
import { readFileSync } from 'node:fs'
import { signIn } from './shots.mjs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const base = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:3401'

const cookies = await signIn(base, 'collaborator')
const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')

const cases = [
  { label: '沈知味的音色，不設風格', body: { voiceId: 'zh-CN-XiaoyiNeural' } },
  { label: '沈知味的音色，生氣', body: { voiceId: 'zh-CN-XiaoyiNeural', style: 'angry' } },
  { label: '台灣音色（沒有風格）', body: { voiceId: 'zh-TW-HsiaoChenNeural', style: 'angry' } },
  { label: '不存在的音色', body: { voiceId: 'zh-XX-NobodyNeural' } },
]

for (const row of cases) {
  const response = await fetch(`${base}/api/speech/preview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      // 瀏覽器那邊由 apiFetch 從 srds_csrf cookie 補上這個標頭。
      'x-csrf-token': cookies.srds_csrf ?? '',
    },
    body: JSON.stringify(row.body),
  })

  if (!response.ok) {
    const text = (await response.text()).slice(0, 120)
    console.log(`  ${row.label.padEnd(22)} ${response.status}  ${text}`)
    continue
  }

  const bytes = (await response.arrayBuffer()).byteLength
  const applied = response.headers.get('x-voice-style')
  console.log(
    `  ${row.label.padEnd(22)} 200  ${String(bytes).padStart(6)} bytes  ` +
      `套到的風格「${applied || '無'}」  ${response.headers.get('content-type')}`
  )
}
