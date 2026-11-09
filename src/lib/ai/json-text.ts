/**
 * 從模型的回覆裡挖出那段 JSON（Z198）。
 *
 * 純函式，沒有任何 import——`scene-draft.ts` 的檔頭說明了為什麼這很重要：解析
 * 器要能被用戶端 import 來做預覽，而一旦它拉到 `@/db` 就會把整個資料層拖進
 * bundle。
 *
 * ## 為什麼抽出來
 *
 * 這兩個函式本來在 `scene-draft.ts` 與 `task-suggestions.ts` 裡各抄了一份，
 * **而且是同一段四行的程式碼**。兩邊的註解還各自記著同一次教訓（模型在 JSON
 * 前後多寫一句話時錨定式 regex 不會命中）。第三個呼叫端出現的時候，抄第三份
 * 的代價就不只是重複——是下一次修 bug 只修到其中一份。
 */

/**
 * 去掉 ```json 圍欄。
 *
 * **刻意是錨定的**（`^…$`）：非錨定版會在「前後多寫一句話」的情況下切出錯誤
 * 的範圍，而那個情況由下面的 `firstJsonBlock` 處理，兩個分工不要混。
 */
export function unwrapJson(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

/**
 * 最後一招：從第一個括號切到最後一個。
 *
 * 模型在 JSON 前後多寫一句「以上是改編稿」時，`unwrapJson` 的錨定式 regex 不
 * 會命中，於是 `JSON.parse` 直接丟。`attribution.ts` 早就踩過這一條。
 *
 * `open` 可以是 `{` 或 `[`——物件與陣列兩種頂層形狀都要撈得到。找不到成對的
 * 括號時回 `null`，讓呼叫端自己決定要丟還是要略過。
 */
export function firstJsonBlock(text: string, open: '{' | '[' = '{'): string | null {
  const close = open === '{' ? '}' : ']'
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}
