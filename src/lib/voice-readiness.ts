/**
 * 一集的配音準備到哪裡了，純算 (Z147).
 *
 * ## 為什麼要獨立成一支
 *
 * 這些判斷原本寫在 `VoiceReadiness` 元件裡，而 `scripts/voice-readiness-truth.ts`
 * 把同一組運算式**又抄了一遍**當對照組——於是那支 probe 是拿頁面跟自己的複
 * 本比。只要兩邊一起錯，它永遠是綠的。子代理審出來的兩條頁面層的錯就正好是
 * 這種：對照組把同一個錯抄了一份。
 *
 * 現在只有一份，而那一份有自己的測試（`tests/voice-readiness.test.ts`）。
 * probe 退回它該做的事：**頁面有沒有把這支函式的答案照實畫出來。**
 *
 * ## 「判過」與「有人說話」是兩件事
 *
 * schema 寫著：`character_id` 是 null 且 `spoken_as` 是空字串的那一列＝「這一
 * 段確定沒有人在說話」，而**沒有那一列**才是「還沒判斷過」。
 *
 * 第一版一律用 `spoken > 0` 當「判過」的代理，於是一集如果判過、而答案是整集
 * 都是旁白（例如純敘事的一集），畫面會說它「沒判過」——**跟事實相反**，而且
 * 會害人再花一次錢重判。所以 `judged` 看 `judged`，`hasSpeakers` 看 `spoken`。
 *
 * 今天這部作品兩個數字一樣（套用時只寫有說話人的段落），所以看不出來。而那
 * 正是這種區別會悄悄壞掉的條件。
 */

export type VoiceAttribution = {
  judged: number
  spoken: number
  speakers: number
  manual: number
  lastAt: Date | null
}

export type VoiceAudio = {
  assetId: string
  durationSec: number | null
  createdAt: Date
}

export type VoiceEpisodeInput = {
  episodeId: string
  number: number
  title: string
  attribution: VoiceAttribution | null
  audio: VoiceAudio | null
}

/**
 * 為什麼這份音檔裡只有一個聲音。
 *
 * - `ok`：沒有音檔，或音檔是在歸屬之後做的。
 * - `no-speakers`：這一集沒有任何可用的說話人（沒判過，或判過而整集都是旁
 *   白），所以合成時只能全部用旁白聲。
 * - `outdated`：**有**說話人，但音檔比歸屬還舊——也就是先合成、後判斷。
 */
export type AudioFreshness = 'ok' | 'no-speakers' | 'outdated'

export type VoiceEpisodeRow = VoiceEpisodeInput & {
  /** 判斷跑過沒有。看 `judged`，不是 `spoken`。 */
  judged: boolean
  /** 判過，而且真的有人在說話。 */
  hasSpeakers: boolean
  freshness: AudioFreshness
}

export type VoiceReadinessSummary = {
  written: number
  judgedCount: number
  voicedCount: number
  /** 判過或有聲音的那幾集，照集號排。 */
  started: VoiceEpisodeRow[]
  /** 已動筆但兩件事都還沒做的集數。 */
  untouched: number
  /** 音檔裡只有一個聲音的那幾集（`freshness !== 'ok'`）。 */
  stale: VoiceEpisodeRow[]
}

/**
 * 「音檔比歸屬舊」也要算 (Z147，子代理審出來的).
 *
 * 決定音檔內容的是**合成那一刻**的歸屬：`audiobook/route.ts` 是在跑的時候才
 * `await attributionFor(episodeId)`。所以「先合成（整集旁白）→ 再跑歸屬」這個
 * 順序走完之後，`spoken > 0` 成立、警示消失、列上顯示「判過 73 段 · 10 人」加
 * 一個時長，看起來完全就緒——而那個 mp3 裡還是只有一個人在唸。
 *
 * 要等有人把三十五分鐘聽完才會發現，正好是這個警示存在的理由。
 *
 * 比的是 `audio.createdAt` 與 `attribution.lastAt`。`lastAt` 在這之前是個沒有
 * 人讀的欄位——它的用途就是這個比較。
 */
function freshnessOf(row: VoiceEpisodeInput, hasSpeakers: boolean): AudioFreshness {
  if (!row.audio) return 'ok'
  if (!hasSpeakers) return 'no-speakers'

  const lastAt = row.attribution?.lastAt
  if (lastAt && row.audio.createdAt < lastAt) return 'outdated'
  return 'ok'
}

export function voiceReadiness(rows: readonly VoiceEpisodeInput[]): VoiceReadinessSummary {
  const classified: VoiceEpisodeRow[] = rows.map((row) => {
    const judged = (row.attribution?.judged ?? 0) > 0
    const hasSpeakers = (row.attribution?.spoken ?? 0) > 0
    return { ...row, judged, hasSpeakers, freshness: freshnessOf(row, hasSpeakers) }
  })

  const started = classified
    .filter((row) => row.judged || row.audio)
    .sort((a, b) => a.number - b.number)

  return {
    written: rows.length,
    judgedCount: classified.filter((row) => row.judged).length,
    voicedCount: classified.filter((row) => row.audio).length,
    started,
    untouched: rows.length - started.length,
    stale: started.filter((row) => row.freshness !== 'ok'),
  }
}

/** `EP007`，給警示與列用。 */
export function episodeLabel(number: number): string {
  return `EP${String(number).padStart(3, '0')}`
}
