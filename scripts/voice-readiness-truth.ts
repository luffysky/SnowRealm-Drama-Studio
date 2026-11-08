import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 資料庫說這部作品的配音準備到哪裡了，印成 JSON (Z147).
 *
 * `probe-voice-readiness.mjs` 拿它當**對照組**：那支 probe 比的是畫面上的數
 * 字跟這裡算出來的一不一樣。
 *
 * 這裡走的是**頁面自己也在用的那三支**（`attributionStatus`、
 * `audiobooksByEpisode`、`voiceReadiness`），所以 probe 驗的是「頁面有沒有把
 * 它們的答案照實畫出來」——接反一欄、少畫一個警告、數字沒更新，它都抓得到。
 *
 * **第一版不是這樣，而那是一個真的洞。** 當時這裡把頁面的分類運算式
 * （`spoken > 0`、`started`、`narratorOnly`）**又抄了一遍**，於是 probe 是拿
 * 頁面跟自己的複本比：兩邊一起錯就永遠是綠的。子代理審出來的兩條頁面層的錯正
 * 好是這種。現在那些判斷只有一份，在 `@/lib/voice-readiness`，而它有自己的測
 * 試。
 */
async function main() {
  const projectId = process.argv[2] ?? '935dc410-79dc-48df-8834-887e9dc59597'

  const { novelIndex } = await import('../src/lib/writing')
  const { attributionStatus } = await import('../src/lib/attribution-job')
  const { audiobooksByEpisode } = await import('../src/lib/assets')
  const { episodeLabel, voiceReadiness } = await import('../src/lib/voice-readiness')

  const rows = await novelIndex(projectId)
  const written = rows.filter((row) => row.charCount > 0)
  const status = await attributionStatus(rows.map((row) => row.episodeId))
  const audio = await audiobooksByEpisode(projectId)

  const summary = voiceReadiness(
    written.map((row) => ({
      episodeId: row.episodeId,
      number: row.number,
      title: row.title,
      attribution: status.get(row.episodeId) ?? null,
      audio: audio.get(row.episodeId) ?? null,
    }))
  )

  console.log(
    JSON.stringify(
      {
        written: summary.written,
        judged: summary.judgedCount,
        voiced: summary.voicedCount,
        startedLabels: summary.started.map((row) => episodeLabel(row.number)),
        judgedLabels: summary.started
          .filter((row) => row.judged)
          .map((row) => episodeLabel(row.number)),
        noSpeakers: summary.stale
          .filter((row) => row.freshness === 'no-speakers')
          .map((row) => episodeLabel(row.number)),
        outdated: summary.stale
          .filter((row) => row.freshness === 'outdated')
          .map((row) => episodeLabel(row.number)),
        untouched: summary.untouched,
      },
      null,
      0
    )
  )
  process.exit(0)
}

void main()
