import { handle, jsonOk, requireUser } from '@/lib/api'
import { speechStatus, voicePool, VOICE_TIER_LABEL } from '@/lib/azure/speech'
import { canCorrect, phonemeSpelling } from '@/lib/tts/pronounce'

export const runtime = 'nodejs'

/**
 * 可以用的音色，給選音色的介面 (Z140).
 *
 * 在這之前，角色頁的「音色 ID」是一個**純文字輸入框**。要填對得憑記憶打出
 * `zh-CN-XiaoxiaoNeural` 這種字串，而 Azure 這個帳號有 556 個音色——那個
 * 欄位實際上是沒辦法用的，所以沒有人釘過任何一個音色。
 *
 * 每一筆都帶著三件**選的時候才需要知道、而且問 Azure 才知道**的事：
 *
 *  - `styles` —— 有幾種情緒風格。台灣的三個音色一種都沒有。
 *  - `canCorrect` —— 改不改得動破音字。粵語吳語多語言一律不行，另外有四個
 *    收下來卻忽略（實測，見 `tts/pronounce.ts`）。
 *  - `tier` —— 它會把中文唸成什麼。粵語音色會把同一份中文唸成粵語。
 *
 * **金鑰不會出門。** 回去的只有音色的名字跟這些能力，沒有任何憑證——這個
 * 檔案在伺服器端跑，而 `speechConfig()` 從頭到尾只被伺服器端讀。
 */
export const GET = handle(async () => {
  // 登入就看得到。音色清單不屬於任何一個作品，所以不做作品權限檢查。
  await requireUser()

  const status = await speechStatus()
  if (!status.available) {
    return jsonOk({ available: false, detail: status.detail, voices: [], tiers: [] })
  }

  const pool = await voicePool()

  return jsonOk({
    available: true,
    detail: status.detail,
    tiers: Object.entries(VOICE_TIER_LABEL).map(([value, label]) => ({ value, label })),
    voices: pool.map((voice) => ({
      id: voice.id,
      label: voice.label,
      locale: voice.locale,
      gender: voice.gender,
      tier: voice.tier,
      speaksChinese: voice.speaksChinese,
      styles: voice.styles,
      /** 改不改得動破音字，以及用哪一種拼寫。 */
      canCorrect: canCorrect(voice.id),
      spelling: phonemeSpelling(voice.id),
    })),
  })
})
