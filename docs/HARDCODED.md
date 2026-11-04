# 寫死的數據盤點（Z98）

2026-11-04 全專案掃過一輪。每一項判定成三類：

| 類別 | 意思 |
| --- | --- |
| **要給活路** | 會隨作品、時間或口味改變。寫死在程式裡 = 要改就得重新部署 |
| **本來就該是常數** | 外部規格、技術限制，或系統的定義本身。改它等於換一套系統 |
| **要從資料算** | 現在是估算或佔位，應該換成真實數字 |

`app_settings` 是 `key / jsonb value` 的表，基礎設施已經在，目前只用了
兩個 key（`fx.rates`、`editor.modules`）。要給活路的大多可以放進去。

---

## 現況（2026-11-04 收尾）

盤點完之後做掉的：

| # | 項目 | 結果 |
| --- | --- | --- |
| 1 | 單集目標字數 | ✅ `projects.target_chars`，新增作品與作品設定都有欄位 |
| 2 | 匯率 | ✅ Z87 系統設定 |
| 3 | R2 單價與免費額度 | ✅ Z87 系統設定 |
| 4 | AI 模型單價 | ✅ Z87 系統設定 |
| 5 | 預設模型 | ✅ **本來就有活路**，見下方說明 |
| 6 | 每個 AI 任務的 effort | ✅ Z87 系統設定，連模型也能逐項指定 |
| 7 | 單集片長 | ✅ 本來就是欄位 |
| 8 | 授權到期提醒 90 天 | 留給 Z8 授權管理，那時才有畫面放它 |
| 9 | 自動儲存延遲 | 留給 Z85 個人設定；這是手感，存瀏覽器就好 |
| 10 | 趨勢圖 30 天 | 留給 Z90 成本中心，做成圖上的切換而不是設定 |

### 第 5 項為什麼不另外做一個設定

本來寫「該放 `app_settings` 的 `ai.defaultModel`」。做到這裡發現**它已經有兩條路了**：

- `ai_providers.default_model` 是欄位，供應商那一列就能改
- 每個任務可以各自指定模型（Z87 的 AI 任務設定）

再加一個全域設定，等於同一個問題有**三個**地方可以回答，而且互相覆蓋的順序
要另外記。程式裡的 `DEFAULT_MODEL` 現在的角色是「兩邊都空著時的最後退路」，
那是常數該做的事。

這一條是盤點自己的建議被盤點的結果推翻——留著原文在下面，不改掉。

---

## 一、要給活路

### 1. 單集目標字數 `4000`

`src/app/(studio)/projects/[projectId]/episodes/[episodeId]/novel/page.tsx:64`

```ts
targetChars={4000}
```

寫在 JSX 裡，連常數都不是。一集 120–180 秒的短劇大概是這個字數，
但那是**這部戲**的節奏；第二部如果走別的路數就不是這個數字。

**該放哪**：`projects` 加一欄 `target_chars`，預設 4000。
它跟 `target_min_sec` / `target_max_sec` 是同一類東西——那兩個已經是
欄位了，字數沒有道理不是。

---

### 2. 匯率 `TWD 1 / USD 0.031 / CNY 0.22`

`src/lib/money.ts:69-74`

```ts
export const DEFAULT_FX: FxRates = {
  base: 'TWD',
  rates: { TWD: 1, USD: 0.031, CNY: 0.22 },
  asOf: '2026-11-03',
  source: '手動輸入（尚未於專案設定更新）',
}
```

**已經有活路**：`getFxRates()` 讀 `app_settings`，這只是沒設定時的 fallback，
`source` 也老實說了「尚未更新」。

**缺的是介面**——沒有任何畫面能寫 `setFxRates()`。歸 Z87 系統設定。
這會直接影響成本中心的數字，第二部開始燒 AI 錢之後會明顯。

---

### 3. R2 單價 `$0.015/GB` 與免費額度 `10 GB`

`src/lib/asset-center.ts:18-19`

```ts
const STORAGE_USD_PER_GB_MONTH = 0.015
const FREE_TIER_GB = 10
```

Cloudflare 的定價，**會變**，而且變了之後資產中心的「估算月費」
會安靜地報錯誤數字——沒有任何地方會提醒。

**該放哪**：`app_settings` 的 `cost.storage`，連同一個「報價日期」欄位，
畫面上標出來，跟匯率同一個處理方式。

---

### 4. AI 模型單價表

`src/lib/ai/anthropic.ts:52-61`

```ts
'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
...
```

同上，而且更會變：新模型出了就要加一列，不然那個模型的花費算不出來。

**該放哪**：`app_settings` 的 `cost.models`。程式裡的表當成
「沒設定時的預設」，不是唯一來源。

---

### 5. 預設模型 `claude-opus-5-5`

`src/lib/ai/anthropic.ts:20`

**該放哪**：`app_settings` 的 `ai.defaultModel`，或更好的做法是
**每個任務各自指定**——大綱生成用 Opus 跟潤稿用 Opus 是兩回事，
後者多花的錢換不到東西。跟第 6 項一起做。

---

### 6. 每個 AI 任務的 effort

`src/lib/ai/prompts.ts:133-153`

```ts
export const TASK_EFFORT: Record<AiTaskKind, 'low' | 'medium' | 'high'> = {
  NOVEL_CONTINUE: 'high',
  OUTLINE_GENERATE: 'medium',
  NOVEL_POLISH: 'low',
  ...
}
```

這組值是**我判斷的**，不是量出來的。哪個任務值得多想，只有實際用過
才知道——而且會隨你的寫法改變。

**該放哪**：`app_settings` 的 `ai.taskProfile`，每個任務存
`{ model, effort }`。程式裡這張表當預設。歸 Z87／Z88。

---

### 7. 單集片長預設 `120–180 秒`、`targetSec 150`

`src/lib/validators.ts:91-92, 114, 188, 298-299`

**已經有活路**：`projects.target_min_sec` / `target_max_sec` 是欄位，
新增作品表單也能填。這些只是 schema 的 default。

**檢查過了，不是 bug**：`episodeSchema` 的 `targetSec: 150` 看起來像是
寫死的，但那個 schema **沒有任何 route 在用**。建集數只有兩個
地方：`createProject()` 與 `scripts/seed.ts`，兩者都用
`(作品 min + max) / 2`。

真正的發現是：**沒有單獨新增集數的 API**。作品建立時排幾集就是
幾集，之後要加第 121 集沒有路徑。這是 Z66（32 批次建立集數），
做那個的時候 `targetSec` 要記得跟作品連動，別熱法烙鐵 150。

---

### 8. 授權到期提醒的 `90 天`

`src/lib/asset-center.ts:147`

```sql
and validUntil <= now() + interval '90 days'
```

多久算「快到期」是看你要多久前開始處理。音樂授權跟圖片授權的
前置時間不一樣。

**該放哪**：`app_settings` 的 `license.warnDays`，預設 90。歸 Z8。

---

### 9. 自動儲存延遲 `2500ms`

`src/components/studio/NovelEditor.tsx:81`

畫面上已經明說「停筆 2.5 秒後」，所以不是黑箱。但打字快的人會覺得
太頻繁，思考久的人會覺得太遲。

**該放哪**：個人設定（Z85），存在瀏覽器裡就好——這是個人手感，
不該同步給另一位成員。跟閱讀器的字級同一個道理。

---

### 10. 趨勢圖的 `30 天`

`src/lib/dashboard.ts:101`、`src/lib/production-progress.ts:72`

已經是函式參數 `trendDays = 30`，只是沒有畫面能傳別的值。

**該放哪**：不用進設定，在圖上放 7／30／90 天的切換就好。

---

## 二、本來就該是常數（不動）

| 值 | 位置 | 為什麼不該可設定 |
| --- | --- | --- |
| 九大製作階段 | `production.ts:27` | 這是系統的定義。改它等於所有 `episode_production_stages` 的資料要重算，而且 spec v3 明寫九個 |
| `MAX_UPLOAD_BYTES = 2 GB` | `constants.ts:451` | R2 單次 PUT 與 Vercel 函式的實際上限，不是政策 |
| `PREVIEW_MAX_BYTES = 8 MB` | `assets.ts:622` | 預覽檔的防呆上限。比這大就不叫預覽了 |
| zip / EPUB 的位元組偏移 | `zip.ts` | ZIP 與 EPUB 規格。改了檔案就開不起來 |
| `PEAK_COUNT = 1600` | `audio-waveform.ts` | 一個像素一個峰值。再多畫不出來，再少會變長方形 |
| 對話估算 5 字/秒、動作 12 字/秒 | `utils.ts:76-77` | 中文朗讀速度。可以**校準**，但不是設定項 |
| Argon2id 參數 | `auth/password.ts` | 安全參數。調低等於降低防護，不該是個開關 |
| 每頁筆數 10／24 | `episode-view.ts`、`asset-browser.ts` | 已經有 `?perPage=`，使用者可以自己改。有活路了 |

---

## 三、要從資料算（現在是估的）

### 1. 「估算月費」只算儲存

`src/lib/asset-center.ts:177`

```ts
estimatedMonthlyUsd: billable * STORAGE_USD_PER_GB_MONTH
```

只有 R2 儲存。**AI 花費沒算進去**，而 AI 會是帳單的大頭——
`usage_ledger` 已經在記了，只是這裡沒讀。

**該做**：把 `usage_ledger` 當月累計加進去，並且拆開顯示，
不要混成一個數字。歸 Z90 成本中心。

### 2. 搜尋門檻 `SEMANTIC_MIN = 0.37`

`src/lib/search/index.ts:80`

這個數字是**量出來的**（`scripts/search-calibrate.ts`），不是猜的，
註解也寫了。但它是對**當時的資料**量的；小說從 3,198 字長到 17,724 字
之後，分布會變。

**該做**：不是設定，是**定期重跑校準腳本**。等三部寫完再測一次。

---

## 修的順序

1. **Z87 系統設定**一次處理匯率、R2 單價、模型單價、AI 任務設定
   ——這四項都是「數字會變，變了算出來的錢就是錯的」
2. **`projects.target_chars`** 跟著第二部一起做，那時才真的需要兩套數字
3. **成本中心把 AI 花費算進去**（Z90）
4. **Z66 批次建立集數**時，`targetSec` 要跟作品的片長連動
