# SnowRealm Drama Studio

雙人 AI 短劇製片管理系統。

正式作品：《一灶見山河》，第一部《萬家燈火》，120 集，每集目標 120–180 秒。

## 技術架構

| 層 | 技術 |
|---|---|
| 前端 | Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS v4 |
| 資料庫 | Neon PostgreSQL + Drizzle ORM |
| 物件儲存 | Cloudflare R2（私有 bucket，S3 相容 API，短效 presigned URL） |
| 登入 | Argon2id 密碼雜湊 + 伺服器端 session（可撤銷）+ 登入限速 |
| AI | 可插拔適配器（目前實作 Claude）+ 資料庫佇列與背景 worker |
| 部署 | Vercel |

## 快速開始

```bash
npm install
cp .env.example .env.local     # 依 docs/ENVIRONMENT.md 填入
npm run db:migrate             # 建立資料表
npm run db:seed                # 建立兩組帳號與作品骨架
npm run dev                    # http://localhost:3400
```

環境變數的完整說明與取得方式見 **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**。

**需要你提供的憑證、圖片與待決定事項，集中在 [docs/NEEDED_FROM_YOU.md](docs/NEEDED_FROM_YOU.md)。**

### 沒有 Neon 也能開發

`npm run db:local` 會用 `embedded-postgres` 在 `127.0.0.1:55432` 起一個真實的
PostgreSQL 17（不需要 Docker），適合離線開發。正式環境一律使用 Neon。

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 正式建置 |
| `npm start` | 執行建置後的版本 |
| `npm test` | 單元測試 |
| `npm run test:smoke` | 對執行中的伺服器做端對端測試 |
| `npm run typecheck` | TypeScript 檢查 |
| `npm run db:generate` | 由 schema 產生 migration |
| `npm run db:migrate` | 套用 migration |
| `npm run db:seed` | 建立帳號與作品骨架（可重複執行） |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:local` | 本機 PostgreSQL（前景執行） |
| `npx tsx scripts/db-check.ts` | 列出資料表、筆數與 enum |

## 專案結構

```
src/
  db/schema/        Drizzle schema（38 張表、30 個 enum）
  lib/
    auth/           密碼、session、權限
    ai/             供應商適配器、提示詞、持久化佇列
    r2.ts           presigned URL、multipart
    assets.ts       素材生命週期（權限檢查在簽章之前）
    approvals.ts    定稿審核與鎖定
    usage.ts        用量帳本與預算攔截
    validators.ts   所有 API 的輸入驗證
  app/
    (auth)/login    登入
    (studio)/       需登入的工作台
    api/            route handlers
  components/
    ui/             共用元件
    studio/         工作台元件
docs/ENVIRONMENT.md 環境變數設定說明
drizzle/            migration SQL
scripts/            seed、db-check、smoke、本機資料庫
```

## 幾個刻意的設計決定

**素材的位元組不經過伺服器。** 瀏覽器向 `/api/uploads` 要一個 presigned URL，
再直接 PUT 到 R2。1 GB 的影片若走 serverless function 會同時撞到請求大小與執行
時間上限。超過 64 MB 自動改用 multipart，單一分段失敗只重試那一段。

**私有 bucket 配穩定網址。** bucket 不開放公開存取也不可列出。畫面上的
`<img src>` 指向 `/api/files/[assetId]`，該路由先驗證 session 與素材歸屬，才當場
簽發短效 URL 並 302 轉址。presigned URL 會過期，直接寫進 HTML 會壞掉。

**AI 產出不會自己寫進正式資料。** 任務完成後停在 `AWAITING_REVIEW`，內容存在
`ai_jobs.result` 裡。只有 `/api/ai/jobs/[id]/apply` 會寫入，且需要明確的
`acknowledge: true`，並先把既有內容存成版本快照，因此套用永遠可以還原。

**金額用 `numeric` 不用浮點數。** 原始幣別與當下匯率一起保存，換算結果永遠可重現。

**兩人都是 Owner，但危險操作要打字確認。** 既然角色檢查擋不住自己人，刪除作品與
刪除素材改用「輸入名稱確認」作為真正的防線。

**AI 任務不在請求裡跑。** `POST /api/ai/jobs` 只排入佇列並回 202，實際生成由
`/api/ai/worker` 執行（Vercel Cron 觸發）。長篇續寫會超過 serverless function
的時間上限，而且請求中斷就會丟掉已付費的工作。claim 用 `FOR UPDATE SKIP LOCKED`，
兩個 worker 不會搶到同一筆；進度由 worker 寫進資料庫，前端輪詢，不用假的計時器。

**同一個 idempotency key 只會付費一次。** 重複送出、重試、連點按鈕都回傳原本那筆任務。

**密碼遷移是無感的。** 保留 bcrypt 驗證；登入成功且雜湊仍是 bcrypt 時，用使用者
本次輸入的密碼重新以 Argon2id 雜湊並條件式更新。舊雜湊不轉換、明文不儲存、不寫日誌。

**沒有內建影片剪輯器。** 剪輯在外部工具進行；本系統管理的是提示詞、素材與進度。

## 目前的完成範圍

本版完成的是**後端與共用元件**（依 UI 規格書 §五 的建議順序第 1 步）：

- ✅ 資料層：38 張表涵蓋作品、集數、小說劇本、角色、世界觀、分鏡、素材、任務、成本、AI、稽核
- ✅ 登入與 session（可撤銷、可列出裝置、改密碼會登出其他裝置）
- ✅ Argon2id + bcrypt 無感遷移、登入限速、security_events 稽核
- ✅ 統一 API 錯誤格式含 `requestId`
- ✅ soft delete 欄位
- ✅ R2 上傳下載：presigned URL、multipart、重試、上傳狀態追蹤
- ✅ AI 持久化佇列：背景 worker、冪等鍵、指數退避、取消、重試、attempt 稽核
- ✅ 共用元件：Dialog、Tabs、Form、Toast、Confirm、Loading、Error、Empty、DiffViewer、StatusChip
- ✅ 定稿審核與鎖定、用量帳本（預估／實際分離）、伺服器端預算攔截
- ✅ 衍生素材分離保存（asset_variants）、世界觀時間線、版本分支、AI 候選列為資料列
- ✅ 登入頁、總儀表板
- ⬜ 其餘 21 個主要頁面與互動對話框（spec v2 的 01–80）尚未實作

依 spec v2 §9 的階段劃分，**M0 基礎已完成，資料層已對齊 §5**。
下一步是 M1（01–05、24–32：作品與 120 集規劃）。

**關於側邊欄**：目前只有「總儀表板」可點。其餘項目依 spec v2 §4
（「尚未串接的功能應禁用並顯示原因，不做空按鈕」）顯示為停用並標示交付階段，
不會連到 404。

測試：79 個單元／整合測試 + 47 項端對端檢查。
