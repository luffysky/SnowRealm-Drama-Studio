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
