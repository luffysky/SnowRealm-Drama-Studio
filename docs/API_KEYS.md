# 要補哪些 API 金鑰

> 這一份只講**金鑰**：哪幾把、去哪裡申請、填在哪裡、不填會怎樣。
> 環境變數的完整清單（資料庫、儲存、種子帳號那些）在 `docs/ENVIRONMENT.md`。

寫於 2026-11-05。七家文字模型（Z151）與模型指派面板（Z152）已經接好，
缺的只有金鑰本身。

---

## 一、現在的狀態

`.env.local` 裡**已經有值**的（不用再補）：

| 變數 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude。目前所有 AI 任務實際在用的就是這一把 |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | 有聲書的 TTS |
| `R2_*` | 素材儲存（私有桶，一律預簽網址） |
| `VOYAGE_API_KEY` | 語意搜尋的向量 |
| `CLOUDFLARE_TURN_*` | 通話中繼。只在點對點連不通時才會用到 |
| `CRON_SECRET` | Vercel Cron 叫 worker 時的憑證 |
| `AUTH_SECRET` | 簽 session cookie |

**還沒有值**的：下面第二節那七把，加上第三節那一把選填的。

---

## 二、七家文字模型（要補的主體）

七家全部走 **OpenAI 相容的 `/chat/completions`**，所以程式裡是一個適配器配
一張廠商表，不是七套實作。base URL 每一個都實際打過（`src/lib/ai/vendors.ts`
的註解寫了判斷方式：401／400 代表端點真的在，404 或 DNS 失敗代表網址錯了）。

| # | 廠商 | 環境變數 | 去哪裡拿 | 能自動抓模型清單 |
|---|---|---|---|---|
| 1 | OpenAI（GPT） | `OPENAI_API_KEY` | https://platform.openai.com/api-keys | ✅ |
| 2 | Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/apikey | ❌ 要手動填模型名 |
| 3 | DeepSeek（深度求索） | `DEEPSEEK_API_KEY` | https://platform.deepseek.com/api_keys | ✅ |
| 4 | Kimi（月之暗面） | `MOONSHOT_API_KEY` | https://platform.moonshot.cn/console/api-keys | ✅ |
| 5 | 通義千問（阿里雲） | `DASHSCOPE_API_KEY` | https://bailian.console.aliyun.com/ | ✅ |
| 6 | 智譜 GLM | `ZHIPU_API_KEY` | https://open.bigmodel.cn/usercenter/apikeys | ✅ |
| 7 | OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys | ✅ |

Gemini 那個 ❌ 不是壞掉：Google 的 OpenAI 相容層沒有實作 `/models`（實測
404），但 `/chat/completions` 是好的。所以那一家要自己把模型名打進去。

OpenRouter 一把金鑰可以轉接上百個模型，**適合先拿它試**再決定要不要單獨
去辦哪一家的帳號。代價是它會多收一層加價。

---

## 三、選填但建議補的一把

| 變數 | 不補會怎樣 |
|---|---|
| `ENCRYPTION_KEY` | 不補的話，供應商金鑰的加密金鑰是從 `AUTH_SECRET` 推導出來的——**換掉 `AUTH_SECRET` 會讓所有存進資料庫的金鑰一起失效**。補了就把兩件事分開。 |

產生方式：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## 四、兩種填法，選一種

### 做法 A：填在介面上（建議）

**AI 製片中心 → 新增供應商**（側邊欄的「AI 製片中心」，網址 `/ai`）

1. 種類選 **`OPENAI_COMPATIBLE`**
2. 廠商下拉選一家——base URL 會自動帶入，不用自己打
3. 貼上金鑰
4. 存檔後按**「抓取可用模型」**，模型下拉就會有那個帳號當下真的能用的清單
5. 按**「測試連線」**確認真的通了

金鑰加密存在資料庫裡（AES-256-GCM）。**明文不會再回來**——回來的只有後四
碼，夠分辨兩把金鑰、不夠拿去用。所以沒有「編輯金鑰」，只有重新填一次。

這個做法的好處是**換金鑰不用重新部署**。

### 做法 B：填在環境變數

`.env.local` 加一行（本機），Vercel 的 Environment Variables 也加同一個名字
（線上）。然後在新增供應商的時候，金鑰欄留白、**環境變數名**那一欄填上面表
格裡的名字。

程式的取用順序是：資料庫裡的金鑰 → 環境變數 →（Claude 才有的）
`ANTHROPIC_API_KEY` 後備。

> ⚠️ 不管哪一種，變數名稱前面**永遠不可以加 `NEXT_PUBLIC_`**。加了就會被
> 編進瀏覽器的 JS 檔，等於把金鑰公開貼出去。

---

## 五、補完之後要做的一件事

**AI 製片中心 → 模型指派**（同一頁下面）。

17 種 AI 任務現在都指派得了，但**沒有指派的時候，系統只會挑第一個能用的供應
商**——所以接了七家也只會用到一家。那張面板就是在解決這件事：

- 對白歸屬（一集三百個機械判斷）→ 便宜又中文好的（DeepSeek）
- 大綱審視、世界觀一致性（要真的想）→ 貴的推理模型
- 潤稿（局部修改）→ 便宜的

指派是在**排隊的時候**套用的，所以 `ai_jobs` 那一列會記下它實際用了哪個模型
與哪個供應商；估價走同一組設定，不會報 A 模型的價、跑 B 模型。

---

## 六、沒補會怎樣（不會壞）

- AI 功能一律顯示明確的「尚未設定」狀態，並寫出缺什麼。
- 其他功能完全正常。
- 任何一顆 AI 按鈕都不會變成「按下去沒反應」——按鈕是禁用的，旁邊寫原因。

這是刻意的：spec v2 §4「尚未串接的功能應禁用並顯示原因，不做空按鈕」。
