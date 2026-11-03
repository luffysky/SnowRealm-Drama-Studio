# 待辦 · 2026-11-03

> SnowRealm Drama Studio V1。依據 `docs/SnowRealm_Drama_Studio_Complete_UI_Spec_v2.md`（**spec v2 為唯一依據，v1 作廢但保留檔案**）。
> 設計圖在 `UI Design/`（80 張，01–80 對應 spec 編號）。
> **完成的用 ~~刪除線~~ 保留可見（不刪）。**
>
> 目前狀態：**M1 進行中**。可點頁面：`/login`、`/dashboard`、`/projects`、`/projects/[projectId]`。

---

## 🏗️ 導覽架構改為 B+（1103 決策，優先於設計圖）

完整內容見 **`docs/ROUTES.md`**。重點：

- 全域側欄只留跨作品功能（儀表板／作品列表／跨作品任務／成本中心／團隊管理／系統設定）
- 作品相關全部移到 `/projects/[projectId]/...`，共用 `ProjectWorkspaceLayout`
- **projectId 一律以 URL 為準**，不得有全域「目前作品」狀態
- 後端必須自己做 projectId 隔離與 RBAC，不能靠前端導覽
- 120 集 × 9 階段只是這部作品的資料，**不可寫死成系統上限**
- `resolveLeaf()` 只是過渡相容，工作區 layout 完成後移除

### 待辦
- [x] ~~建立 `projects/[projectId]/layout.tsx` + 工作區頁首／Tab／切換作品~~ ✅ 1103
- [x] ~~把 04 自己畫的 Hero 與 Tab 搬進共用 layout~~ ✅ 1103
- [x] ~~裁減全域側欄成六項跨作品功能~~ ✅ 1103
- [x] ~~移除 `resolveLeaf()`~~ ✅ 1103
- [x] ~~補路由表與導覽元件的測試~~ ✅ 1103（`tests/navigation.test.ts` + 作品存取測試）
- [ ] 新增作品相關 API 時記得呼叫 `requireProjectApi()`——layout 的檢查不算數

---

## 🔴 M1 作品與集數（下一棒就做這個）

照使用者 1103 定的順序：**儀表板 → 03/04/05 → 24–32**。儀表板已完成，接下來是 03/04/05。

### 進度
- [x] ~~**01 總儀表板重做**~~ ✅ 1103（`9278261`）——對著 `UI Design/01_dashboard.png`：問候橫幅（依時段變早安/午安/下午好/晚安）、雙人成員卡、快速操作 6 格、6 個統計磚（含警示色邊框）、專案進度 + 9 階段條、支出圓環（純 SVG 無圖表庫）、AI 任務狀態、待辦/近期活動/今日重點。**所有數字查真實資料**，空資料庫就顯示 0 與空狀態。
- [x] ~~**03 作品列表**~~ ✅ 1103（`7f68d08`）——篩選膠囊（計數永遠算全量，不受篩選影響）、搜尋（標題 + 標籤）、排序、格狀/列表切換、收藏（每人各自一份）、右側詳情欄。
- [x] ~~**04 作品總覽**~~ ✅ 1103——`src/app/(studio)/projects/[projectId]/page.tsx` + `ProjectOverview.tsx`，資料層 `src/lib/project-overview.ts`。Hero（麵包屑／標題／標籤／logline）、8 分頁列（只有「總覽」可點，其餘標階段）、5 張統計卡、7 步製作流程（手機轉直向）、分集列表（桌機表格／手機堆疊）、素材資產 6 格、AI 生成統計、待辦任務、近期動態。**全部空狀態都寫實**，沒有捏造數字。
- [ ] **05 集數列表**（`projects/[projectId]/episodes/page.tsx`）**⏸ 等 GPT 修正後的設計圖**
- [ ] **24–29 作品表單六 Tab**（`ProjectFormDialog.tsx`，設計圖 `24_`~`29_`）
- [ ] **30 AI 作品企劃** / **31 封面上傳裁切** / **32 批次建立集數**

### ⏸ 01 / 04 / 05 / 17 暫停：等新版設計圖

使用者 1103：「gpt會修正01、04、05、17這幾張UI 你等等看 改好我會跟你說」。
這四張的版面在新圖到手前不要動；**架構層（B+ 工作區 layout）可以先做**，
因為那與視覺無關。

### ⚠️ 05 集數列表的關鍵認知（舊圖的理解，新圖到手後要重新確認）
**不是 120 格網格。** 我原本一直假設是網格，看了設計圖才發現錯。實際是：

- 分頁表格，**每頁 10 筆、12 頁**，底部有 `共120集 每頁10集` + 頁碼 + `前往 __ 頁`
- 上方 5 個 Tab：集數列表 / 分集策劃 / 排程甘特圖 / 批次操作 / 版本管理
- 篩選列：搜尋框、全部狀態、全部階段、負責人、**格狀/列表切換**
- 表格欄位：checkbox、集數（縮圖+EP001+標題）、狀態 chip、**製作階段 5 個 icon**、進度條+%、負責人（雙頭像）、預計完成、操作（播放/編輯/更多）
- **右側詳情欄**：選中集數的預覽播放器、集數資訊、分階段進度百分比、AI 工具快速操作 6 格

### 執行方式（每頁）
1. **先讀設計圖**（`UI Design/0X_*.png`）再寫 code。不要照 spec 文字腦補版面。
2. 查詢全部走真實資料。**示意數字不得寫死**（spec v2 §0）。
3. 未實作的按鈕/連結 → **停用並標示階段**，不做空按鈕、不連 404（spec v2 §4）。
4. 鐵規則 gate：`tsc --noEmit` / `eslint` / `vitest run` / `next build` 全綠 → 更新工作日誌 → commit / push。
5. 新頁面做好後，去 `src/lib/navigation.ts` 把對應項目的 `ready` 改成 `true`。
   - 屬於單一作品的項目（href 含 `/_`）由 `resolveLeaf()` 代入當前作品 id；不在作品頁時會停用並顯示「需選作品」，不會連到 `/projects/_` 變 404。
6. **RWD 一定要實際截圖驗證**，不要讀 class 名稱自我感覺良好：
   `node scripts/shots.mjs --base http://127.0.0.1:3400 --out .shots projects dashboard`
   （phone 390 / tablet 820 / desktop 1440 各一張全頁 PNG；會自己用 `SEED_OWNER_*` 登入）

---

## 🟠 等使用者提供才能動（已寫進 `docs/NEEDED_FROM_YOU.md`）

### ~~🚨 Vercel 方案~~ ✅ 已決定：**Hobby**（1103）
使用者：「Hobby 已經買了你跟GPT了 沒錢養其他東西了」。已完成對應調整：
- ~~cron 改每天 03:00~~ ✅ 當保險，撿退避重試到期但沒人在線的任務
- ~~前端推一下 worker~~ ✅ `src/lib/ai/client.ts` 的 `submitAiJob` 送完就 nudge，所以感覺是即時的
- ~~worker 雙身分驗證~~ ✅ cron bearer（跳 CSRF，因為帶 Authorization 的請求不可能是 CSRF）或登入成員（強制 CSRF）。匿名兩條路都不通
- ~~配合 60 秒 function 上限~~ ✅ `maxDuration=60`、AI 單次輸出預設 8000 tokens（`AI_MAX_OUTPUT_TOKENS` 可調）、worker 單次預設處理 1 筆

> **之後升 Pro 要改的**：schedule → `*/1 * * * *`、`maxDuration` → 300、`AI_MAX_OUTPUT_TOKENS` 可拉高。

**⚠️ 成本預期**（使用者明確表示預算緊）：Neon、R2 都有免費額度，本專案用量在免費範圍內。
**唯一會真的花錢的是 Anthropic API**（按 token 計價，非訂閱）。
所以 `usage.ts` 的預算攔截建議一定要設上限 —— 見 F3。

### 憑證（部署前必須）
- [ ] Neon：`DATABASE_URL`（pooled，host 含 `-pooler`）+ `DATABASE_URL_UNPOOLED`（direct）
- [ ] R2：`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`
- [ ] R2 bucket 要**維持私有**（不開 r2.dev、不綁自訂網域）+ **設 CORS**（`ExposeHeaders` 必須有 `etag`，否則分段上傳合併失敗）
- [ ] 兩組正式帳號的 email / 顯示名稱 / 初始密碼
- [ ] （選用）`ANTHROPIC_API_KEY` —— 沒有的話 AI 功能顯示「尚未啟用」，其餘不受影響
- [ ] `AUTH_SECRET` / `ENCRYPTION_KEY` / `CRON_SECRET` —— 我可以產生，等使用者說一聲

### 介面裝飾圖 4 張（GPT 生，放 `public/`）
目前用 `.art-placeholder` 漸層佔位，**沒有也能跑**。

- [ ] `logo-mark.png` 512×512 透明 —— 雪花紋章，紫→青漸層，無文字
- [ ] `rail-foot.png` 512×400 —— 古風夜景燈籠，**整體偏暗**、上緣與左右淡出
- [ ] `hero-banner.png` 1920×400 —— 夜景橫幅，**左側 40% 要夠暗**（疊問候文字）
- [ ] `login-bg.png` 1920×1080 —— 同風格但更暗更散焦，**中央必須很暗**

### 劇情設定（spec v2 §10 列為待確認，決定前系統一律留空不自動填）
- [ ] 女主正式姓名（設計圖的「林婉兒」是示意）
- [ ] 王朝正式名稱
- [ ] 120 集完整正史（目前 120 集都是空殼，只有集號）
- [ ] 確認「重生在灶房」「風起長安」只是設計圖示意，不是真的要做的第二三部

### 系統行為
- [ ] **F1 雙人審核是否預設強制？** 目前實作 A（任一人可定稿並鎖定）；改成 B（須另一人審核）是小改動
- [ ] **F2 圖片/影片/語音 AI 供應商要用哪家？** 目前只有 Claude（文字）有 adapter，其餘顯示「尚未支援」
- [ ] **F3 要設每月 AI 花費上限嗎？金額？** 預算攔截已做好，但沒設上限就是不限

---

## 🟡 M2～M4（還沒排程，先記著）

- [ ] **M2 創作**：06 小說編輯器、07 劇本編輯器、08 版本紀錄、09 世界觀、10/11 角色、33–65
- [ ] **M3 視覺素材**：12 分鏡工作台、13 鏡頭詳情、14–16 素材、66–72
- [ ] **M4 營運**：17 進度、18/19 任務、20 團隊、21/22 設定、23 成本、73–80

---

## 🟢 技術債 / 待補（不急但別忘）

- [ ] **spec v2 §6.2 素材保留期** —— `scripts/purge-stale-uploads.ts` 只清「從未完成的上傳」。已完成素材刪除後的 R2 物件保留期還沒做（目前 `deleteAsset` 直接刪物件，但會先擋有引用的）。
- [ ] **視覺尚未完全對齊設計圖** —— 外殼與 token 已改成霓虹玻璃風，但設計圖的縮圖、hero 插畫、成員頭像都還是漸層佔位（等圖）。
- [ ] **`debug_pic/` 已加入 .gitignore** —— 那是除錯截圖不是交付物。使用者若要納管再拿掉。
- [ ] **UI Design 174MB 已進 repo**（使用者 1103 同意）。之後若設計圖頻繁改版，考慮搬 Git LFS —— git 無法 diff 二進位，改一次就多存一份完整副本。

---

## 注意（踩過的坑，別再犯）

- **先看設計圖再寫版面。** 05 集數列表差點做成 120 格網格，實際是分頁表格 + 右側詳情欄。
- **`cookies().set()` 不能在 Server Component 呼叫** —— 會讓每一頁 500。要設 cookie 只能在 middleware / Route Handler / Server Action。
- **佇列的時間比較要用資料庫時鐘** —— `next_attempt_at` 由 DB 寫入，拿 Node 的 `new Date()` 比會因時鐘偏移漏掉剛排入的任務。用 SQL `now()`。
- **Drizzle 的 `sql\`... = any(${陣列})\`` 不會序列化 JS 陣列** —— 用 `inArray()`。
- **先檢查外部服務設定再寫資料庫** —— `beginUpload` 原本先 commit 再碰 R2，缺金鑰時留下清不掉的 PENDING 列。
- **`cursor-not-allowed` 只給真正「想按但不行」的表單控制項** —— 導航上的「還沒做」用 `cursor-default` + 淡 hover，不然整排滑過去都是 🚫。
- **本機跑 `next start` 時 cookie 的 `secure`** 綁 `x-forwarded-proto` 而非 NODE_ENV，否則用 LAN IP 測會整個登不進去。
- **測試要隔離** —— 佇列測試之間會互相吃掉 worker 的 claim 額度，每個 test 前要清 `ai_jobs`。
