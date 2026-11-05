/**
 * 接得上的文字模型廠商 (Z151).
 *
 * 「模型全接 你全部寫進去我後面補 API_KEY」。
 *
 * ## 一個適配器，七家
 *
 * GPT、Gemini、DeepSeek、Kimi、千問、GLM、OpenRouter——**全部都提供 OpenAI
 * 相容的 `/chat/completions`**，差別只在 base URL、金鑰與模型名，而那三樣
 * `ai_providers` 本來就有欄位。所以不是七個 enum 值配七個適配器，是一個
 * `OPENAI_COMPATIBLE` 配一張廠商表。
 *
 * Gemini 原生的 API 不長這樣，但 Google 自己提供了一層 OpenAI 相容端點，
 * 所以它也走同一條路。
 *
 * ## 為什麼這裡沒有模型清單
 *
 * 因為寫下去的那一刻就開始過期。模型名稱是這個領域變最快的東西，而一份
 * 寫死的清單會在某天變成「選單裡有、打過去 404」。
 *
 * 所以改成**跟廠商要**：`/models` 端點七家有六家支援（Gemini 的相容層沒做
 * 這支），介面上一顆「抓取可用模型」把結果存進 `ai_providers.available_models`。
 * 這樣清單永遠是那個帳號當下真的能用的。
 *
 * ## base URL 是打過才寫的
 *
 * 每一個都實際請求過。401／400 代表端點真的在、只是要授權；404 或 DNS 失敗
 * 就代表網址錯了，而一個錯的 base URL 會變成一個永遠連不上的供應商，而且
 * 錯誤訊息只會說「連不上」。
 */

export type VendorPreset = {
  id: string
  label: string
  /** 不含結尾斜線。適配器自己接 `/chat/completions`。 */
  baseUrl: string
  /** 建議的環境變數名，給不想把金鑰存進資料庫的人。 */
  envVarName: string
  /** 去哪裡拿金鑰。 */
  keyUrl: string
  /** `/models` 列得出來嗎——列不出來的要手動填模型名。 */
  listsModels: boolean
  /** 一句話，給選的人判斷。 */
  note: string
}

/**
 * 驗證過的廠商清單。
 *
 * `listsModels: false` 只有 Gemini：它的 OpenAI 相容層沒有實作 `/models`
 * （實測 404），但 `/chat/completions` 是好的（實測 400「缺 Authorization」）。
 */
export const VENDORS: VendorPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI（GPT）',
    baseUrl: 'https://api.openai.com/v1',
    envVarName: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    listsModels: true,
    note: '英文與程式碼強；中文創作未必勝過國產模型。',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envVarName: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    listsModels: false,
    note: '走 Google 的 OpenAI 相容層。它沒有做 /models，模型名要自己填。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com',
    envVarName: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    listsModels: true,
    note: '便宜，中文好。對白歸屬那種高量機械判斷最適合它。',
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    envVarName: 'MOONSHOT_API_KEY',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    listsModels: true,
    note: '長上下文見長，適合一次讀很多集。',
  },
  {
    id: 'qwen',
    label: '通義千問（阿里雲）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envVarName: 'DASHSCOPE_API_KEY',
    keyUrl: 'https://bailian.console.aliyun.com/',
    listsModels: true,
    note: '中文創作強。走 DashScope 的相容模式端點。',
  },
  {
    id: 'glm',
    label: '智譜 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envVarName: 'ZHIPU_API_KEY',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    listsModels: true,
    note: '中文穩定，價格中等。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（一把金鑰接很多家）',
    baseUrl: 'https://openrouter.ai/api/v1',
    envVarName: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    listsModels: true,
    note: '一個帳號轉接上百個模型，適合先試再決定要不要單獨辦帳號。會多一層加價。',
  },
]

export function vendorByBaseUrl(baseUrl: string): VendorPreset | null {
  const normalised = baseUrl.trim().replace(/\/+$/, '')
  return VENDORS.find((vendor) => vendor.baseUrl === normalised) ?? null
}

export function vendorById(id: string): VendorPreset | null {
  return VENDORS.find((vendor) => vendor.id === id) ?? null
}
