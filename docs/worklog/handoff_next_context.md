# 交接給下一個 Context（更新於 2026-11-03）

> 接力棒。能安全 commit 的都推上線了，`tsc` / `eslint` / `vitest` / `next build` 全綠、tree 乾淨。
> **完成的用 ~~刪除線~~ 保留可見（不刪）。**
>
> **現況**：M0 基礎完成 + 設計系統外殼 + 儀表板重做，首次推上 GitHub（`9278261`）。
> **可點頁面只有 `/login` 與 `/dashboard`**，其餘導航項目都停用並標示交付階段（spec v2 §4 要求，不做空按鈕、不連 404）。
>
> **下次最該優先：03 作品列表 → 04 作品總覽 → 05 集數列表。動手前務必先看 `UI Design/0X_*.png`。**

---

## 🚨 開工前必讀的三件事

### 1. spec v2 是唯一依據
`docs/SnowRealm_Drama_Studio_Complete_UI_Spec_v2.md`（80 張編號）。
`docs/SnowRealm_Drama_Studio_Complete_UI_Spec.md`（v1，53 張）**已作廢但保留檔案**，別拿來設計。

### 2. 設計圖在 `UI Design/`（空格，不是底線）
80 張 PNG，`01_dashboard.png` ~ `80_ai_job_queue.png`，對應 spec 編號。
**寫版面前先讀圖。** 我差點把 05 集數列表做成 120 格網格，實際是分頁表格 + 右側詳情欄。

### 3. 設計圖裡的內容全是示意，不得當正史
「林婉兒」「沈昭」「重生在灶房」「風起長安」「EP001 煙火初見」、NT$16,320、72% —— 全是 GPT 生的示意內容。
**女主姓名、王朝名、120 集正史都還沒定案**，系統裡一律留空，不自動填（spec v2 §0、§10）。
已確立不會動的線索：許山河、前世、穿越、失憶、梅花印記。

---

## ✅ 這一棒已完成（保留紀錄，勿刪）

- ~~**M0 基礎**~~ ✅ 38 張表 / 30 enum、登入與可撤銷 session、R2 presigned 上傳下載（multipart + 重試 + 狀態追蹤）、AI 持久化佇列、共用元件。
- ~~**Argon2id**~~ ✅ `m=19456, t=2, p=1`，bcrypt 無感遷移（條件式更新，6 並發實測恰好 1 筆 rehash）。
- ~~**登入限速 / CSRF / requestId / soft delete**~~ ✅
- ~~**資料層對齊 spec v2 §5**~~ ✅ 補齊 7 張表 + 定稿鎖定 + 用量帳本 + 預算攔截。
- ~~**設計系統 + 兩層外殼**~~ ✅ 霓虹玻璃 token、上方主選單 + 樹狀側欄。
- ~~**01 儀表板重做**~~ ✅ 所有數字查真實資料。
- ~~**文件**~~ ✅ `ENVIRONMENT.md`、`NEEDED_FROM_YOU.md`、`todo/todo_list_1103.md`、`worklog/daily_works_1103.md`。

詳細過程與抓到的 10 個 bug 見 `daily_works_1103.md`。

---

## 🔨 待辦（照這順序）

### 一、M1 頁面（下一棒主線）
1. **03 作品列表** `src/app/(studio)/projects/page.tsx`
2. **04 作品總覽** `projects/[projectId]/page.tsx`
3. **05 集數列表** `projects/[projectId]/episodes/page.tsx` ← 看下面的結構說明
4. **24–29 作品表單六 Tab** → **30 AI 企劃** → **31 封面裁切** → **32 批次建集數**

做完一頁就去 `src/lib/navigation.ts` 把對應項目 `ready` 改 `true`。

### 二、等使用者提供（已整理在 `docs/NEEDED_FROM_YOU.md`）
- 🚨 **Vercel 方案 Hobby/Pro** —— 唯一卡著的問題
- Neon 兩條連線字串、R2 四個值、兩組正式帳號
- 4 張介面裝飾圖（目前漸層佔位，沒有也能跑）
- 女主姓名 / 王朝名 / 120 集正史
- F1 雙人審核是否強制、F2 圖片影片語音用哪家 AI、F3 預算上限

---

## 📐 05 集數列表的實際結構（照 `UI Design/05_episodes.png`）

**不是 120 格網格。**

- 麵包屑：作品列表 / 一灶見山河 / 集數列表
- 作品 hero 卡：封面、標題、類型標籤、共120集、進度
- 統計列：已完成 / 製作中 / 待製作 / 整體進度
- **5 個 Tab**：集數列表 / 分集策劃 / 排程甘特圖 / 批次操作 / 版本管理
- 動作鈕：新增集數、批次管理、匯出清單
- 篩選列：搜尋、全部狀態、全部階段、負責人、**格狀/列表切換**
- 表格：checkbox、集數（縮圖+EP001+標題）、狀態 chip、**製作階段 5 icon**、進度+%、負責人雙頭像、預計完成、操作
- 分頁：`共120集 每頁10集` + 頁碼 1~12 + `前往 __ 頁`
- **右側詳情欄**：預覽播放器、集數資訊、分階段進度%、AI 工具快速操作 6 格

---

## ⚠️ 踩過的坑（別再犯）

- **`cookies().set()` 不能在 Server Component** —— 會讓每頁 500。只能 middleware / Route Handler / Server Action。
- **佇列時間比較要用 DB 時鐘** —— `next_attempt_at` 由 DB 寫入，拿 Node `new Date()` 比會因時鐘偏移漏掉剛排入的任務。用 SQL `now()`。
- **Drizzle `sql\`= any(${陣列})\`` 不序列化 JS 陣列** —— 用 `inArray()`。
- **先檢查外部服務設定再寫 DB** —— `beginUpload` 原本先 commit 再碰 R2，缺金鑰留下清不掉的 PENDING 列。
- **`cursor-not-allowed` 只給真正「想按但不行」的表單控制項** —— 導航的「還沒做」用 `cursor-default` + 淡 hover。使用者直接抱怨過「hover為啥都禁止符號」。
- **不做空按鈕、不連 404**（spec v2 §4）—— 使用者點到 404 抱怨過。新增任何導航項或跨頁連結，頁面不存在就停用 + 標階段。
- **`next start` 的 cookie `secure`** 綁 `x-forwarded-proto` 而非 NODE_ENV，否則 LAN IP 測試整個登不進去。
- **測試要隔離** —— 佇列測試會互吃 worker claim 額度，每個 test 前清 `ai_jobs`。
- **使用者的 hydration 錯誤多半是 Bitdefender 擴充**（`bis_skin_checked`），不是程式問題。判斷法：看差異屬性是不是全部 `bis_*`、堆疊有沒有應用 frame、curl 伺服器 HTML 有沒有那些屬性。

---

## 🔑 本機開發

```bash
npm run db:local      # embedded-postgres 在 :55432（不需 Docker，前景執行）
npm run db:migrate
npm run db:seed       # 兩組帳號 + 《一灶見山河》120 集空殼
npm run dev           # http://localhost:3400
```

**本機測試帳號**（`.env.local`，非正式值）：
- `owner@snowrealm.local` / `local-dev-only-1`（暖寶 CEO）
- `cto@snowrealm.local` / `local-dev-only-2`（林鍶恩 技術總監）

**驗證**：
```bash
npm test                      # 79 單元/整合
npm run build && npm start    # 另開終端機
npm run test:smoke            # 53 端對端
npx tsx scripts/db-check.ts   # 列出資料表/筆數/enum
```

⚠️ `npm run test:smoke` 會重設密碼雜湊與清 `security_events`，**只能對本機或 dev 資料庫跑**（腳本本身有擋 Neon）。

---

## 🧱 鐵規則

1. 動版面前先看 `UI Design/` 對應的設計圖。
2. 所有數字查真實資料，**示意數字不得寫死**（spec v2 §0）。
3. AI 產出一律停在 `AWAITING_REVIEW`，只有明確的人工動作能寫進正式資料，且先存版本快照。
4. 金鑰只在伺服器端，**沒有任何變數可以加 `NEXT_PUBLIC_`**。
5. gate 全綠（`tsc` / `eslint` / `vitest` / `next build`）→ 更新工作日誌 → commit / push。
