# 工作日誌 · 2026-11-03

> SnowRealm Drama Studio V1。本日從零到 **M0 基礎完成 + 設計系統外殼 + 儀表板重做**，並首次推上 GitHub。
> commit `9278261`（rebase 在 GitHub 自動產生的 `637785f Initial commit` 之上，未覆蓋）。

---

## 本日完成（保留紀錄，勿刪）

### 架構三次轉向（使用者逐步定案）

- ~~**初版用 Prisma + Vercel Blob**~~ → 作廢。使用者後來定案 **Neon + Drizzle + Cloudflare R2**，整個資料層與儲存層重寫。
- ~~**原本「不串接付費 AI API」**~~ → 使用者 1102 推翻：「AI現在要加進去 真實AI 之後會串API GPT一開始搞錯 現在改」。AI 改為正式功能。
- ~~**UI spec v1（53 張）**~~ → 使用者給了 **v2（80 張）**，「v1我先不刪 但你認這版就好」。

### A 批：M0 安全缺口（使用者指定順序 A → B → C）

- ~~**Argon2id 取代 bcrypt**~~ ✅ `@node-rs/argon2`，參數 `m=19456, t=2, p=1`（使用者指定）。保留 bcrypt 驗證能力，登入成功且仍是 bcrypt 時，用**使用者本次輸入的明文**重新雜湊，以**條件式更新**（`where id = ? and password_hash = <剛驗證的那個>`）寫回。舊雜湊不轉換、明文不存、不寫日誌。
  - 實測 6 個並發登入：**全部成功、恰好 1 個執行 rehash**、race 後雜湊仍有效。
  - `Algorithm` 是 `const enum`，`isolatedModules` 不准當值匯入 → 用 `const ARGON2ID = 2 as Algorithm`，並寫測試斷言產出的雜湊真的以 `$argon2id$` 開頭。
  - `@node-rs/argon2-linux-x64-gnu` 在 lockfile 裡，Vercel 會取到預編譯 binary。
- ~~**AI 佇列改成持久化**~~ ✅ 原本 `runJob()` 同步跑在 HTTP 請求裡，長篇生成必定撞 Vercel function 時間上限。改成 `src/lib/ai/queue.ts` + `/api/ai/worker`（Vercel Cron）。claim 用 `FOR UPDATE SKIP LOCKED`、冪等鍵、指數退避（30s/2m/8m）、取消、重試、lease 逾時回收、`ai_job_attempts` 逐次稽核。
- ~~**登入限速**~~ ✅ 每 email 8 次 / 每 IP 25 次 / 15 分鐘，靠 `security_events` 計數（serverless 不能用記憶體計數器）。成功後歸零但不刪稽核。回 429 帶 `Retry-After`。
- ~~**`requestId`**~~ ✅ 每個回應都有 `x-request-id`，錯誤 body 同一個 id，伺服器日誌同步。
- ~~**soft delete**~~ ✅ 8 張主要表加 `deletedAt`。

### B 批：資料層對齊 spec v2 §5

- ~~**補齊 7 張表**~~ ✅ `world_events`、`version_branches`、`approval_records`、`asset_variants`、`ai_outputs`、`usage_ledger`、`notifications`。**共 38 張表、30 個 enum。**
  - 另外 14 個「缺的」其實只是命名不同（`story_arcs`=`arcs`、`scripts`=`documents`、`content_versions`=`versions`…），不建重複表。
- ~~**定稿鎖定**~~ ✅ `src/lib/approvals.ts`。核准釘住確切版本並上鎖；解鎖**必須寫原因**，且是新增 `UNLOCKED` 列去 supersede 原本那筆 —— 不改也不刪，誰鎖的誰開的為什麼全留著。
- ~~**用量帳本 + 預算攔截**~~ ✅ `src/lib/usage.ts`。預估與實際是兩筆；實際結算後對應預估不再計入 committed。預算在**排入佇列前**擋（入列後 worker 就會跑，事後攔來不及），且會把**已承諾但未結算**的算進去，否則連丟 10 個任務會在任何一筆結算前集體衝破上限。

### C 批：CSRF（使用者 1103 回「要」）

- ~~**CSRF 雙層防護**~~ ✅ Origin/Referer 檢查 + double-submit token。強制點放在 `handle()` 包裝層，新端點預設受保護。`/api/ai/worker` 豁免（Cron 沒 cookie，用自己的 bearer secret）。
  - 實測 6 項：沒 token 擋、token 錯擋、來源 evil.example.com 擋（即使 token 正確）、GET 不受影響、正常請求能進 handler。

### 設計系統 + 外殼

- ~~**globals.css 重寫**~~ ✅ 對齊設計圖的霓虹玻璃：底色深靛紫 `#0a0618`、面板往上 7 階帶紫調、**violet→magenta 漸層 + 外發光**取代粗邊框。新增 `.panel` / `.glass` / `.glow-accent` / `.bg-brand-gradient` / `.art-placeholder`。金色收窄到只給「定稿 / CEO / 已通過」。
- ~~**兩層導航**~~ ✅ `src/lib/navigation.ts`（單一來源）+ `StudioShell.tsx`。上方橫向主選單 9 區 + 左側樹狀側欄（可展開）。品牌區、通知/說明鈕、使用者下拉選單。
- ~~**01 儀表板重做**~~ ✅ 對著 `UI Design/01_dashboard.png`。**所有數字查真實資料**；實測確認畫面上無「重生在灶房」「風起長安」「林婉兒」「沈昭」「16,320」等設計圖示意內容。

### 其他

- ~~**`docs/ENVIRONMENT.md`**~~ ✅ 368 行，Neon/R2/CRON/Argon2id 的逐步設定與疑難排解。
- ~~**`docs/NEEDED_FROM_YOU.md`**~~ ✅ 使用者或 GPT 要處理的所有事項集中一處。
- ~~**首次 push GitHub**~~ ✅ 195 檔含 80 張設計圖（使用者 1103 同意「圖一起commit沒關係」）。推前逐項確認 `.env.local` 被忽略、無硬編碼密鑰、無檔案近 100MB 上限。

---

## 🐛 本日抓到的真實 bug（都不是測試寫壞，是程式真錯）

1. **佇列時鐘偏移** —— `next_attempt_at` 由資料庫寫入，我卻拿 Node 時鐘比對。偏差幾毫秒就讓剛排入的任務看起來「排在未來」而不被取用。正式環境只會偶發，極難查。**改用 SQL `now()`。**
2. **`sql\`id = any(${ids})\`` 不序列化 JS 陣列** → 改 `inArray()`。測試抓到的。
3. **`beginUpload` 先寫資料庫才碰 R2** —— 缺金鑰時留下永遠清不掉的 PENDING 素材（我自己測試累積 5 筆）。改成**先檢查設定**；另寫 `scripts/purge-stale-uploads.ts` 清理，已清掉那 5 筆。
4. **`deleteAsset` 不檢查引用就刪 R2 物件** —— 違反 spec v2 §6.2。改成先查 `asset_links`、版本血緣、`shots` 六個 asset 欄位，有引用就拒絕並回報引用在哪。
5. **`cookies().set()` 在 Server Component 裡會 throw** —— 我把 CSRF cookie 放 root layout，結果**每一頁 500**。移到 `src/middleware.ts`。
6. **cookie `Secure` 綁 NODE_ENV** —— `next start` 時會設 Secure，用 `http://192.168.0.11:3400` 從手機測會整個登不進去且看不出原因。改綁 `x-forwarded-proto`。
7. **側邊欄連到 8 個不存在的路由** —— 使用者直接點到 404（「你沒有一頁做完?怎麼點下去都404」）。違反 spec v2 §4。改成停用 + 標示階段。
8. **`cursor-not-allowed` 濫用** —— 20 個導航項目全是 🚫（「hover為啥都禁止符號」）。那游標的語意是「你想做的事被擋下」，不該用在「這功能還沒做」。改 `cursor-default` + 淡 hover。
9. **圓環在 `map` 裡累加變數** —— render 期間的 mutation，React 編譯器 lint 擋下。改成先 reduce 算好所有弧段。
10. **`<pre>` 裡放 `<div>`** —— 無效 HTML 嵌套，正是 React 列的 hydration mismatch 成因之一。

---

## 📋 使用者回報的 errlog 分析（結論：不是程式問題）

使用者丟了 `docs/errlog.md`，是 hydration mismatch。**34 個差異屬性全部來自 Bitdefender 瀏覽器擴充**（`bis_skin_checked` 30 個、`bis_register` 2 個、`__processed_<uuid>__` 2 個）。

三個證據：零個應用層差異、堆疊是 `at div (<anonymous>)` 沒有任何元件 frame、curl 伺服器送出的 HTML 搜不到這些屬性。

但 log 裡**有兩個真問題**順手修了：`experimental.serverActions` 是我留的死設定（專案一個 Server Action 都沒用）；`DiffViewer` 的 `<pre><div>` 無效嵌套。

---

## ✅ 驗證狀態（收工時）

```
typecheck   PASS
lint        PASS（0 errors, 0 warnings）
單元/整合    79 passed（4 檔）
端對端       53 passed
build       成功
npm audit   0 vulnerabilities
```

測試涵蓋：Argon2id 參數與遷移、並發登入、限速、CSRF 四種攻擊路徑、佇列 claim/backoff/冪等/lease 回收、定稿鎖定與解鎖歷史、用量帳本不重複計算、預算攔截、衍生素材不共用 object key、R2 物件鍵不含原檔名且防穿越。

---

## 🔨 下一棒接手點

**使用者 1103 定的順序**：~~儀表板~~ → **03 作品列表 → 04 作品總覽 → 05 集數列表** → 24–32 作品表單。

詳見 `docs/todo/todo_list_1103.md`。最關鍵的一點先講：

> **05 集數列表不是 120 格網格。** 是分頁表格（每頁 10 筆、12 頁）+ 5 個 Tab + 篩選列 + **右側詳情欄**。我原本一直假設是網格，看了 `UI Design/05_episodes.png` 才發現。**動手前先看設計圖。**

**唯一卡著的問題**：Vercel 用 Hobby 還是 Pro？影響 `vercel.json` 的 cron 頻率（Hobby 最短每天一次，目前設每分鐘）。

---

# 第二段（同日下午）

## 1. 資料庫搬到 Neon

使用者把 `.env.local` 的 `DATABASE_URL` 換成 Neon（`ep-icy-dew-ao0xrvif`，ap-southeast-1，PostgreSQL 18.6）。連線驗證通過，schema 是空的，跑完 migration 得到 **39 張表 / 30 個 enum / 132 個索引**。

**順手補的安全洞**：破壞性測試（會 truncate 的那幾個檔）原本只認 `DATABASE_URL`，換成 Neon 之後它們不是去刪正式資料，就是整批 skip 讓涵蓋率無聲下降。加了 `TEST_DATABASE_URL`：

- 應用程式連 Neon，測試連本機 `embedded-postgres`（`npm run db:local`）
- `tests/helpers/database.ts` 的 `testDatabaseReady()` 統一判斷，三個測試檔和 `scripts/smoke.ts` 共用
- 沒設 `TEST_DATABASE_URL` 又指著 Neon → 測試直接 skip，不會誤刪

## 2. 登入改成「帳號 + 密碼」

使用者在 `.env.local` 自己加了 `SEED_OWNER_ACCOUNT` / `SEED_COLLABORATOR_ACCOUNT`，並把 email / 帳號 / 密碼都換成真值 ——「email 跟帳號不一樣」。

- `users` 新增 `account` 欄位（migration `0004_omniscient_franklin_storm.sql`）。唯一索引建在 `lower(account)` 且 `where account <> ''`：大小寫不敏感，沒設帳號的列不互相卡住。
- `loginSchema` 改收 `identifier`（帳號或 email 都行），保留 `email` 當別名，所以 `scripts/smoke.ts` 原本的 13 處呼叫完全不用改。
- 登入查詢改成 `lower(email) = ? OR (account <> '' AND lower(account) = ?)`。
- 登入表單第一格從 `type="email"` 改成 `type="text"`（否則瀏覽器會先擋掉「Niannian」這種帳號），標籤補「輸入帳號或 Email 皆可」。
- `PASSWORD_MIN_LENGTH` 10 → **8**。使用者設的密碼是 8 和 9 碼。這確實低於公開服務該有的標準，所以在 code 裡寫明理由：這是封閉的雙人工具、沒有註冊路徑，真正擋暴力破解的是 `rate-limit.ts` 的登入限速，而不是熵。

**實測**（`next start` 連 Neon）：帳號登入 200、帳號大小寫不敏感 200、email 登入 200、協作者帳號 200、錯誤密碼 401、不存在帳號 401、缺 CSRF token 403、跨站 Origin 403。

**踩到的坑**：`db:seed` 是依 email upsert，使用者改了 email 之後 Neon 上變成 4 個帳號（舊的兩個 `@snowrealm.local` 沒被改名，是多出來的）。寫了 `scripts/prune-users.ts` 處理 —— 預設 dry-run、要 `--apply` 才真的刪、拒絕刪掉目前 `SEED_*_EMAIL` 指到的帳號、也拒絕刪掉還擁有作品的人。清完剩正確的兩筆。

另外兩支維護腳本：
- `npm run account:check` —— 檢查雜湊演算法與參數、實際試一次驗證、確認會拒絕錯誤密碼，全程不印明文
- `npm run account:password -- --email <帳號或Email> [--new-email <新Email>]` —— 密碼從 stdin 讀（不進 shell history），改完撤銷該帳號所有 session

> **關於 Neon Auth**：不開。那是 Neon 主控台的代管身分服務（底層 Stack Auth），開了密碼會交給第三方，我們自己的 `password_hash`、Argon2id、bcrypt 無感遷移、session 撤銷就全部失效，而且多一個要養的外部服務。向 Neon 要的只有 Postgres。

## 3. Favicon 與 PWA

- `scripts/make-icons.mjs` —— 一份 SVG 原始碼（六角雪花，紫→洋紅漸層，對齊 `.bg-brand-gradient`）產生全部尺寸：`src/app/icon.svg`、`icon.png` 48、`apple-icon.png` 180、`public/icons/icon-{192,512}.png`、`icon-maskable-512.png`（maskable 版縮到 0.62 並去圓角，才不會被啟動器裁掉）。產物已進 repo，sharp 只是 Next 的間接依賴，不放進 build 流程。
- **沒做 `favicon.ico`**：sharp 寫不出 ICO 容器，把 PNG 改名叫 `.ico` 比沒有還糟。`icon.svg` + `icon.png` 已涵蓋所有現役瀏覽器。
- `src/app/manifest.ts` —— `display: standalone`、`start_url: /dashboard`、theme/background `#0a0618`、三個圖示（含 maskable）。
- `public/sw.js` —— **故意做得很窄**。導覽（HTML）一律走網路，失敗才給 `/offline`；`/api/*` 完全不碰；只有 `/_next/static/`、`/icons/`、manifest、圖示走 cache-first。每一頁都在 session 後面，快取住 HTML 等於把一個人的畫面給另一個人看、或讓登出後的頁面還活著。登出時額外送 `srds:clear-cache` 清乾淨。
- 只在 production 註冊 service worker（dev 的 bundle 沒有 hash，worker 擋在前面只會製造「為什麼還是舊的」）。

## 4. RWD 真的去量了

寫了 `scripts/shots.mjs`：用 Node 內建的 WebSocket 直接驅動 Chrome DevTools Protocol（不裝 Puppeteer），先用 `SEED_OWNER_*` 照瀏覽器的方式登入拿 cookie，再在 **phone 390 / tablet 820 / desktop 1440** 三個視窗各截一張全頁 PNG。

截出來才看到的三個真問題（讀 class 名稱絕對看不出來）：

1. **作品列表的右側詳情欄在平板上**：欄位掉到格狀下方變成整頁寬，16:9 的封面就成了一塊 460px 高的空漸層。改成 `h-32 sm:h-40 xl:h-auto xl:aspect-video`，只有真的變成側欄時才套比例。
2. **手機上搜尋框被擠爛**：和排序下拉、檢視切換擠同一列，placeholder 只剩「搜尋作品名稱或」。`sm` 以下改成獨佔一整列。
3. **1440px 筆電上 5 張統計卡斷成 3+2**：原本斷點給到 `2xl`（1536），改成 `xl`。

（Git Bash 會把 `/login` 這種參數改寫成 Windows 路徑，所以腳本接受不帶斜線的寫法。）

## 5. 04 作品總覽

`src/app/(studio)/projects/[projectId]/page.tsx` + `src/components/studio/ProjectOverview.tsx`，資料層 `src/lib/project-overview.ts`。**純 Server Component，不送任何 JS**。

- Hero：麵包屑、標題、狀態 chip、類型標籤、logline（還沒寫就明講「尚未撰寫」，不捏造）
- 8 個分頁：只有「總覽」可點，其餘停用並標 M2/M3/M4
- 5 張統計卡：製作進度、集數規劃、預計時程、製作預算、主要負責
- 7 步製作流程：對應到 9 個 `episode_stages`，企劃與發行沒有 stage 列，改從作品狀態推導。桌機橫向連線、手機轉直向（七個有字的節點塞不進 390px）
- 分集列表：前 8 集，桌機 `table-fixed` 表格、手機堆疊卡片，並明講其餘 112 集要等 05 頁
- 素材資產 6 格、AI 生成統計、待辦任務、近期動態 —— 目前全是空狀態，每一格都寫了「空」的理由

`src/lib/navigation.ts` 加了 `resolveLeaf()`：href 含 `/_` 的項目會代入當前網址裡的作品 id；不在作品頁時停用並顯示「需選作品」，不會連到 `/projects/_` 吃 404。03 的「進入作品詳情」也改成真的連結。

**一個 lint 擋下來的真問題**：`DueChip` 在 render 裡讀 `Date.now()`（`react-hooks/purity`）。算到期天數搬進資料層，元件回到純函式——這頁是伺服器算完再 hydrate，在 render 讀時鐘就是在等 hydration mismatch。

## ✅ 驗證狀態（第二段收工）

```
typecheck   PASS
lint        PASS（0 errors, 0 warnings）
測試        91 passed（5 檔，接本機 PG）
build       成功
登入        帳號/email/大小寫/錯誤密碼/CSRF 三種攻擊 全部符合預期
RWD         phone 390 / tablet 820 / desktop 1440 三種寬度實際截圖檢查過
```

## 🔨 下一棒

**05 集數列表**。再提醒一次：**不是 120 格網格**，是分頁表格（每頁 10 筆、12 頁）+ 5 個 Tab + 篩選列 + 右側詳情欄。先看 `UI Design/05_episodes.png`。
