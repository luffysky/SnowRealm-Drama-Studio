# 環境變數設定說明

SnowRealm Drama Studio V1 — Neon PostgreSQL + Cloudflare R2 + Vercel

本文件列出系統執行所需的**全部**環境變數、各自的用途、以及逐步取得方式。

> **安全原則**
> 下列變數**沒有任何一個**可以加上 `NEXT_PUBLIC_` 前綴。全部僅在伺服器端（Server Component、Route Handler、Server Action）讀取。一旦加上 `NEXT_PUBLIC_`，Next.js 會把值編譯進瀏覽器端的 JavaScript，等同公開你的資料庫與儲存空間金鑰。
>
> `.env.local` 已列入 `.gitignore`，請勿解除。真實金鑰不要寫進 `.env.example`、不要貼進 commit、不要貼進 issue。

---

## 總覽

| 變數 | 必填 | 用途 |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon 連線字串（**pooled**），應用程式執行期間使用 |
| `DATABASE_URL_UNPOOLED` | ✅ | Neon 連線字串（**direct / unpooled**），僅供 migration 使用 |
| `AUTH_SECRET` | ✅ | 簽發與驗證登入 session cookie |
| `ENCRYPTION_KEY` | ⬜ | 加密資料庫中的 AI 供應商金鑰。留空則由 `AUTH_SECRET` 衍生 |
| `R2_ACCOUNT_ID` | ✅ | Cloudflare 帳號 ID，用於組出 R2 的 S3 endpoint |
| `R2_ACCESS_KEY_ID` | ✅ | R2 API Token 的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 API Token 的 Secret Access Key |
| `R2_BUCKET` | ✅ | 存放素材的 bucket 名稱 |
| `R2_ENDPOINT` | ⬜ | 覆寫 S3 endpoint。留空則由 `R2_ACCOUNT_ID` 自動推導 |
| `PRESIGN_TTL_SECONDS` | ⬜ | Presigned URL 有效秒數，預設 `300`（5 分鐘） |
| `ANTHROPIC_API_KEY` | ⬜ | Claude API 金鑰。未設定時 AI 功能顯示「尚未啟用」，其餘功能不受影響 |
| `AI_MAX_OUTPUT_TOKENS` | ⬜ | AI 單次輸出上限，預設 `8000`（配合 Hobby 的 60 秒限制） |
| `VOYAGE_API_KEY` | ⬜ | 語意檢索金鑰，在 MongoDB Atlas 建立（Voyage 已被 MongoDB 併購）。未設定時搜尋退回純關鍵字，介面會明說 |
| `VOYAGE_BASE_URL` | ⬜ | 覆寫 embedding API 端點。留空則依金鑰前綴自動判斷（`al-` 走 ai.mongodb.com，`pa-` 走 api.voyageai.com） |
| `VOYAGE_MODEL` | ⬜ | Embedding 模型，預設 `voyage-4`（1024 維）。更換會讓既有向量全部失效 |
| `CRON_SECRET` | ✅ | AI 背景 worker 的憑證。未設定則 worker 停用，AI 任務會一直停在佇列 |
| `SEED_OWNER_EMAIL` | ✅* | 初始化 Owner 帳號 |
| `SEED_OWNER_ACCOUNT` | ✅* | Owner 的登入帳號（短名稱） |
| `SEED_OWNER_NAME` | ✅* | Owner 顯示名稱 |
| `SEED_OWNER_PASSWORD` | ✅* | Owner 初始密碼（存入前做雜湊） |
| `SEED_COLLABORATOR_EMAIL` | ✅* | 初始化 Collaborator 帳號 |
| `SEED_COLLABORATOR_NAME` | ✅* | Collaborator 顯示名稱 |
| `SEED_COLLABORATOR_PASSWORD` | ✅* | Collaborator 初始密碼（存入前做雜湊） |

✅* = 只有執行 `npm run db:seed` 建立帳號時需要。帳號建立完成後，可以從 Vercel 移除這六個變數，應用程式執行期間不會讀取它們。

---

## 1. Neon PostgreSQL

### 1.1 建立專案

1. 登入 <https://console.neon.tech>
2. **Create project**
3. 設定：
   - **Project name**：`snowrealm-drama-studio`
   - **Postgres version**：17（預設即可）
   - **Region**：選離 Vercel 部署區域最近的。台灣使用者建議 `Asia Pacific (Singapore)` 或 `Asia Pacific (Tokyo)`，並讓 Vercel 的 Function Region 設成同一區，可省下跨區來回延遲
   - **Database name**：`snowrealm_drama_studio`

### 1.2 取得兩條連線字串

建立完成後，在專案首頁的 **Connection string**（或 **Connect**）面板：

**取得 `DATABASE_URL`（pooled）**
- 將 **Connection pooling** 開關**打開**
- 複製字串，host 會包含 `-pooler`，例如：
  ```
  postgresql://neondb_owner:<密碼>@ep-xxxx-xxxx-pooler.ap-southeast-1.aws.neon.tech/snowrealm_drama_studio?sslmode=require
  ```

**取得 `DATABASE_URL_UNPOOLED`（direct）**
- 將 **Connection pooling** 開關**關閉**
- 複製字串，host **不含** `-pooler`：
  ```
  postgresql://neondb_owner:<密碼>@ep-xxxx-xxxx.ap-southeast-1.aws.neon.tech/snowrealm_drama_studio?sslmode=require
  ```

> 兩條字串的差別只在 host 有沒有 `-pooler`，帳號密碼相同。
>
> **為什麼要兩條**：Vercel 的 serverless function 每次請求可能是新的執行實例，連線數容易爆掉，所以應用程式走 pooled（PgBouncer）。但 PgBouncer 的 transaction 模式不支援 migration 需要的 session 級指令（例如 advisory lock），所以 `drizzle-kit migrate` 必須走 direct 連線。
>
> **`sslmode=require` 必須保留**，Neon 不接受未加密連線。若你複製到的字串還帶有 `channel_binding=require`，一併保留即可。

### 1.3 本機開發用的獨立分支（建議）

不要讓本機開發直接寫進正式資料庫。Neon 的 branch 功能可以複製一份：

1. Neon 專案左側 → **Branches** → **Create branch**
2. Branch name：`dev`，從 `main`（或 `production`）建立
3. 在該 branch 頁面取得它自己的 pooled / direct 字串，寫進本機的 `.env.local`

這樣本機和正式環境的資料完全隔離，schema 卻保持一致。

> **離線備案**：沒有網路時，可以執行 `npm run db:local`，它會用 `embedded-postgres` 在 `127.0.0.1:55432` 起一個本機 PostgreSQL 17（不需要 Docker），連線字串為
> `postgresql://srds:srds_local_dev@127.0.0.1:55432/snowrealm_drama_studio`
> 這只是開發便利工具，正式環境一律使用 Neon。

---

## 2. Cloudflare R2

### 2.1 建立 bucket

1. 登入 <https://dash.cloudflare.com>
2. 左側選單 → **R2**（第一次使用需先啟用，會要求綁定付款方式，免費額度內不扣款）
3. **Create bucket**
   - **Bucket name**：`snowrealm-drama-studio`
   - **Location**：`Asia-Pacific (APAC)`
4. 建立完成

> **私有性確認**：R2 bucket 建立後預設就是私有的，不會有任何公開網址。請**不要**去開啟 bucket 設定裡的 **Public Development URL**（`r2.dev`），也**不要**綁定 Custom Domain。只要這兩項都不開，外界就無法直接存取或列出檔案，所有讀寫都必須經過本系統後端簽發的短效 URL。

### 2.2 取得 `R2_ACCOUNT_ID`

在 R2 總覽頁右側會顯示 **Account ID**，是一串 32 碼的十六進位字元。

也可以從瀏覽器網址列讀出來 —— `dash.cloudflare.com/<這一段就是 Account ID>/r2/overview`。

### 2.3 建立 API Token 取得金鑰

1. R2 頁面右上 → **Manage R2 API Tokens** → **Create API token**
2. 設定：
   - **Token name**：`snowrealm-drama-studio-app`
   - **Permissions**：選 **Object Read & Write**
     （不要選 Admin Read & Write。應用程式只需要讀寫物件，不需要建立或刪除 bucket 的權限）
   - **Specify bucket(s)**：限定只給上一步建立的 `snowrealm-drama-studio`
     （不要留在 "Apply to all buckets"）
   - **TTL**：若無特殊需求選 Forever
3. **Create API Token**
4. 畫面會顯示：
   - **Access Key ID** → 填入 `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → 填入 `R2_SECRET_ACCESS_KEY`
   - **Endpoint** → 形如 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

> ⚠️ **Secret Access Key 只會顯示這一次**，關閉視窗就再也看不到。請立刻複製到安全的地方（密碼管理器）。遺失只能重新建立 token。

> ⚠️ **`R2_ENDPOINT` 結尾不可包含 bucket 名稱。** Cloudflare 介面上顯示的 S3 API 網址是
> `https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>`，直接貼進來會讓 SDK 再接一次
> bucket，物件變成存在 `drama/drama/…` 底下。正確值是
> `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，或乾脆**留空**讓程式從
> `R2_ACCOUNT_ID` 自行推導。設錯時 `src/lib/r2.ts` 會直接拋出錯誤並告訴你正確值。

### 2.4 設定 CORS（瀏覽器直接上傳必須）

本系統的大型素材是由瀏覽器拿到 presigned URL 後**直接 PUT 到 R2**，不經過 Vercel（避免 serverless function 的請求大小與執行時間限制）。這屬於跨來源請求，必須在 bucket 上設定 CORS，否則上傳會被瀏覽器攔下。

1. bucket 頁面 → **Settings** → **CORS policy** → **Add CORS policy**
2. 貼入以下內容（`AllowedOrigins` 已填入本專案的實際網域）：

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3400",
      "http://127.0.0.1:3400",
      "https://dramastudio-neon.vercel.app",
      "https://dreama.snowrealm.pet"
    ],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

說明：
- **`localhost` 與 `127.0.0.1` 在瀏覽器眼中是兩個不同的來源**，本機開發兩個都要列，否則換個寫法開頁面就會被擋
- `PUT` 給單檔上傳與 multipart 分段上傳（`src/components/studio/useUploader.ts` 的 `putWithProgress`）
- `GET` 給瀏覽器跟著 `/api/files/[assetId]` 的 307 轉址去取檔。`<img>`、`<video>` 這類標籤本身不需要 CORS，但用 `fetch()` 下載時需要
- **不需要 `HEAD`**：上傳完成後的存在性檢查（`headObject`）是伺服器端用 S3 SDK 發的，不經過瀏覽器，也就不經過 CORS
- `AllowedHeaders` 只需要 `content-type`。`content-length` 是瀏覽器自己帶的禁用標頭，寫了也不會出現在 preflight
- **不要**把 `authorization` 加進去。presigned URL 的簽章在 query string 裡，不走 Authorization 標頭；列了只會擴大允許範圍
- `etag` 必須 expose，multipart 合併時要收集每個分段的 ETag
- 之後若再綁新的自訂網域，記得把它加進 `AllowedOrigins`
- Vercel 的 preview 網址每次不同。要在 preview 測上傳就暫時加 `https://*.vercel.app`，正式環境只列明確網域
- **`AllowedOrigins` 不要寫 `*`**。CORS 擋不住有簽章的人，但 `*` 等於允許任何網站在使用者登入狀態下對你的 bucket 發請求

### 2.5 驗證設定

全部填好後跑一次健檢，它會真的上傳、下載、分段上傳、取消、刪除各一回，
並對四個來源重放瀏覽器的 CORS preflight：

```bash
npm run r2:check
```

寫入的物件都在 `__healthcheck__/` 底下且會自行刪除，不會碰到任何實際素材。

### 2.6 Preview 環境建議用另一個 bucket

若會使用 Vercel preview 部署測試，建議再建一個 `snowrealm-drama-studio-preview`，避免測試檔案混進正式素材庫。在 Vercel 的 Preview 環境把 `R2_BUCKET` 指向它即可，其他金鑰可共用。

---

## 3. AUTH_SECRET

簽發登入 session cookie 用的密鑰。**自行產生，不要沿用任何範例值。**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

輸出類似 `kJ8mN2pQ...`（43 字元）。

本機與正式環境請使用**不同**的值。更換這個值會使所有既有登入 session 立即失效（兩人需重新登入），其餘資料不受影響。

### 3.1 ENCRYPTION_KEY（選填）

用於加密**存在資料庫裡**的 AI 供應商 API 金鑰（AES-256-GCM）。

留空時，系統會用 HKDF 從 `AUTH_SECRET` 衍生一把獨立的加密金鑰，功能完全正常。

⚠️ **但留空有一個後果**：之後若更換 `AUTH_SECRET`，已存的 AI 金鑰會無法解密，必須重新輸入。若你希望「換 session 密鑰」與「換加密密鑰」兩件事互不影響，就另外設定這一個：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 3.2 ANTHROPIC_API_KEY（選填）

Claude API 金鑰，從 <https://console.anthropic.com> 取得。

AI 金鑰有兩種存放方式，擇一即可：

| 方式 | 做法 | 適合 |
|---|---|---|
| 環境變數 | 設定 `ANTHROPIC_API_KEY` | 只有一組金鑰、不常更換 |
| 資料庫 | 在「AI 模型連線與金鑰設定」填入 | 要在介面上更換、或要管理多個供應商 |

兩者都設定時，資料庫中的設定優先。

**未設定也不影響系統運作**：AI 相關功能會顯示明確的「尚未啟用」狀態並說明缺少什麼，其餘所有功能（小說、劇本、分鏡、素材、進度、成本）完全正常。

### 3.3 CRON_SECRET（AI 功能必填）

AI 任務不在 HTTP 請求裡執行 —— 長篇生成會超過 Vercel function 的時間上限。
`POST /api/ai/jobs` 只把任務排入佇列，實際執行由 `/api/ai/worker` 負責，
由 Vercel Cron 每分鐘觸發一次（設定在 `vercel.json`）。

這個端點不能靠登入 session 保護（cron 呼叫沒有 cookie），改用 Bearer token：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

在 Vercel 的環境變數填入 `CRON_SECRET` 後，Vercel Cron 觸發時會自動帶上
`Authorization: Bearer $CRON_SECRET`。

**未設定時的行為**：worker 回傳 503 並停用，AI 任務會一直留在 `QUEUED` 狀態。
這是刻意的 fail-closed —— 沒有憑證就不執行，而不是讓端點開放給任何人觸發付費請求。

### Hobby 方案的三個限制（本專案已針對 Hobby 調整）

**1. cron 每天只能一次。** `vercel.json` 設為每天 03:00，當作「撿漏網之魚」的保險 ——
專門處理退避重試到期、但當下沒人在使用系統的任務。

> ⚠️ **`vercel.json` 不能寫註解。** JSON 本身沒有註解語法，而且 Vercel 的 schema 是
> 嚴格模式：`crons[]` 物件只允許 `path` 與 `schedule` 兩個欄位，多放任何東西
> （包括自訂的 `_comment`）都會讓建置直接失敗，錯誤是
> `[INVALID_VERCEL_CONFIG] crons[0] should NOT have additional property`。
> 所有說明都寫在這份文件裡，不要寫回設定檔。

**2. 即時執行靠前端推一下。** 送出 AI 任務後，前端會呼叫一次
`POST /api/ai/worker`（`src/lib/ai/client.ts` 的 `submitAiJob`）。
因此 worker **同時接受兩種身分**：

| 呼叫者 | 驗證方式 | CSRF |
|---|---|---|
| Vercel Cron | `Authorization: Bearer $CRON_SECRET` | 跳過（帶 Authorization 標頭的請求不可能是 CSRF） |
| 已登入成員 | session cookie | **強制**，要帶 `x-csrf-token` |

匿名呼叫兩條路都走不通，外人無法觸發付費請求。

**3. function 執行上限 60 秒。** 超過就被砍掉 —— 而那不是「比較慢」，
是**already 付過錢的工作直接遺失**。因此：

- `maxDuration = 60`（Pro 可到 300）
- AI 單次輸出上限預設 **8000 tokens**，可用 `AI_MAX_OUTPUT_TOKENS` 調整
- worker 單次預設只處理 1 筆（cron 那次才抓 5 筆）

> **升級 Pro 之後要改的**：`vercel.json` 的 schedule 改 `*/1 * * * *`、
> worker 的 `maxDuration` 改 `300`、`AI_MAX_OUTPUT_TOKENS` 可拉高。
> 前端推一下的機制留著也無妨，只是變成多餘。

---

## 4. 初始帳號

系統不開放註冊，兩組帳號由 `npm run db:seed` 建立。

密碼使用 **Argon2id**（`@node-rs/argon2`，參數 `memoryCost=19456 KiB`、`timeCost=2`、
`parallelism=1`）雜湊後才寫入資料庫，資料庫內不會留下明文。

> **舊 bcrypt 帳號的無感遷移**：系統保留 bcrypt 的驗證能力。若某個帳號的雜湊還是
> bcrypt，使用者下次登入成功時，會用他本次輸入的密碼重新以 Argon2id 雜湊並更新，
> 使用者完全不會察覺，也不需要重設密碼。舊雜湊不會被「轉換」（數學上不可能），
> 而是以明文重新計算後整筆取代；更新採條件式寫入，兩人同時登入也不會互相覆蓋。

| 變數 | 說明 |
|---|---|
| `SEED_OWNER_EMAIL` | Owner 的 email |
| `SEED_OWNER_ACCOUNT` | Owner 的登入帳號（短名稱，與 email 無關） |
| `SEED_OWNER_NAME` | Owner 顯示名稱，例如「製片」 |
| `SEED_OWNER_TITLE` | Owner 職稱，預設 `CEO` |
| `SEED_OWNER_PASSWORD` | Owner 初始密碼 |
| `SEED_COLLABORATOR_EMAIL` | Collaborator 的 email |
| `SEED_COLLABORATOR_ACCOUNT` | Collaborator 的登入帳號 |
| `SEED_COLLABORATOR_NAME` | Collaborator 顯示名稱，例如「編導」 |
| `SEED_COLLABORATOR_TITLE` | Collaborator 職稱，預設 `技術總監` |
| `SEED_COLLABORATOR_PASSWORD` | Collaborator 初始密碼 |

**登入方式**：帳號或 email 都可以，兩者皆不分大小寫。帳號限英數字與 `.` `_` `-`，
長度 3–32，且兩個人不可重複（唯一索引建在 `lower(account)`）。

**權限差異**
- **Owner**：全部製作內容的讀寫，加上成員管理與刪除作品
- **Collaborator**：全部製作內容的讀寫，不能管理成員或刪除作品

密碼最低 8 字元（`src/lib/auth/password.ts` 的 `PASSWORD_MIN_LENGTH`），建議更長。
seed 執行完畢後，這些變數即可從 Vercel 刪除。

> ⚠️ **`db:seed` 是依 email 做 upsert。** 之後改 `SEED_*_EMAIL` 再 seed 一次，會多出
> 一個帳號而不是改名。要改帳密請改用：
>
> ```bash
> npm run account:check                                   # 檢查目前帳號狀態
> npm run account:password -- --email <帳號或Email> [--new-email <新Email>]
> npx tsx scripts/prune-users.ts --email <舊Email>          # 先 dry-run
> npx tsx scripts/prune-users.ts --email <舊Email> --apply  # 確認後才刪
> ```

> **為什麼不用 Neon Auth？** Neon 主控台的 Auth 是代管身分服務（底層 Stack Auth），
> 啟用後密碼由第三方保管，本專案的 `password_hash`、Argon2id 參數、bcrypt 無感遷移、
> session 撤銷與登入限速都將失效，而且多一個需要維護的外部服務。本專案只向 Neon
> 取用 Postgres。

---

## 5. 本機 `.env.local`

在專案根目錄建立 `.env.local`（此檔已被 gitignore）：

```bash
# ---- Neon（建議使用 dev branch，不要用正式 branch）----
DATABASE_URL=postgresql://neondb_owner:密碼@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/snowrealm_drama_studio?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://neondb_owner:密碼@ep-xxxx.ap-southeast-1.aws.neon.tech/snowrealm_drama_studio?sslmode=require

# ---- 登入 ----
AUTH_SECRET=自行產生的值

# ---- Cloudflare R2 ----
R2_ACCOUNT_ID=你的32碼帳號ID
R2_ACCESS_KEY_ID=你的Access Key ID
R2_SECRET_ACCESS_KEY=你的Secret Access Key
R2_BUCKET=snowrealm-drama-studio

# ---- 選填 ----
# R2_ENDPOINT=
# PRESIGN_TTL_SECONDS=300

# ---- 初始帳號（seed 後可刪）----
SEED_OWNER_EMAIL=
SEED_OWNER_ACCOUNT=
SEED_OWNER_NAME=
SEED_OWNER_TITLE=
SEED_OWNER_PASSWORD=
SEED_COLLABORATOR_EMAIL=
SEED_COLLABORATOR_ACCOUNT=
SEED_COLLABORATOR_NAME=
SEED_COLLABORATOR_TITLE=
SEED_COLLABORATOR_PASSWORD=

# ---- 測試用資料庫（DATABASE_URL 指向 Neon 時必填）----
# 破壞性測試只會跑在這裡，永遠不會碰 Neon。先 `npm run db:local` 啟動。
TEST_DATABASE_URL=postgresql://srds:srds_local_dev@127.0.0.1:55432/snowrealm_drama_studio

# ---- AI（選填，未設定則 AI 功能顯示「尚未啟用」）----
ANTHROPIC_API_KEY=

# ---- 語意檢索（選填，未設定則搜尋只做關鍵字比對）----
VOYAGE_API_KEY=
```

填好後依序執行：

```bash
npm install
npm run db:migrate     # 建立資料表
npm run db:seed        # 建立兩組帳號與《一灶見山河》專案骨架
npm run dev            # http://localhost:3400
```

驗證安裝是否正確：

```bash
npx tsx scripts/db-check.ts   # 列出所有資料表與筆數
npm test                      # 單元測試
npm run build && npm start    # 另開一個終端機
npm run test:smoke            # 對執行中的伺服器做端對端測試
```

---

## 6. Vercel 設定

### 6.1 填入變數

專案 → **Settings** → **Environment Variables**，逐一新增。

| 變數 | Production | Preview | Development |
|---|---|---|---|
| `DATABASE_URL` | 正式 branch（pooled） | dev/preview branch（pooled） | 可留空，本機讀 `.env.local` |
| `DATABASE_URL_UNPOOLED` | 正式 branch（direct） | dev/preview branch（direct） | 同上 |
| `AUTH_SECRET` | 專用值 | 可與 Production 不同 | 同上 |
| `R2_ACCOUNT_ID` | ✅ | ✅ | 同上 |
| `R2_ACCESS_KEY_ID` | ✅ | ✅ | 同上 |
| `R2_SECRET_ACCESS_KEY` | ✅ | ✅ | 同上 |
| `R2_BUCKET` | `snowrealm-drama-studio` | `...-preview` | 同上 |

新增時務必確認**沒有勾選**任何會暴露到前端的選項，且變數名稱不含 `NEXT_PUBLIC_`。

> **Neon 官方整合（替代做法）**：Vercel 的 Marketplace 有 Neon integration，連結後會自動注入 `DATABASE_URL`、`DATABASE_URL_UNPOOLED` 等變數，並能為每個 preview 部署自動開一個資料庫 branch。若使用此整合，就不需要手動填前兩個變數 —— 但請確認它注入的名稱與上表一致，不一致時以上表為準手動補上。

### 6.2 Function Region

**Settings → Functions → Function Region** 設成與 Neon 同一區（例如 Neon 選 Singapore，這裡也選 Singapore `sin1`）。跨區會讓每個資料庫查詢多出可觀的往返延遲。

### 6.3 部署後

1. 第一次部署完成後，執行一次 migration 與 seed。最簡單的方式是在本機把 `.env.local` 暫時指向正式 Neon branch，然後：
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
   完成後記得把 `.env.local` 改回 dev branch。
2. 確認 2.4 節的 CORS `AllowedOrigins` 已包含要上線的網域（`dramastudio-neon.vercel.app` 與 `dreama.snowrealm.pet` 已列入）
3. 用 Owner 帳號登入，確認可以上傳一張圖片並正常顯示

---

## 7. 疑難排解

| 現象 | 可能原因 |
|---|---|
| `password authentication failed` | 連線字串的密碼被截斷，或密碼含特殊字元未做 URL encode |
| `too many connections` | 應用程式誤用了 direct 連線。確認 `DATABASE_URL` 的 host 含 `-pooler` |
| migration 卡住或報 advisory lock 錯誤 | `DATABASE_URL_UNPOOLED` 誤填成 pooled 字串。確認它的 host **不含** `-pooler` |
| 上傳時瀏覽器 console 出現 CORS 錯誤 | R2 的 CORS policy 未設定，或 `AllowedOrigins` 沒有包含目前網域（注意 http/https 與連接埠要完全一致，且 `localhost` 與 `127.0.0.1` 算兩個來源）。跑 `npm run r2:check` 可直接看出是哪個來源沒過 |
| 檔案上傳成功但路徑變成 `drama/drama/…` | `R2_ENDPOINT` 結尾多了 bucket 名稱，見 2.3 節的警告 |
| 上傳回 `SignatureDoesNotMatch` | `R2_SECRET_ACCESS_KEY` 有誤，或 `R2_ACCOUNT_ID` 與金鑰不屬於同一個 Cloudflare 帳號 |
| 圖片顯示破圖 | presigned URL 已過期。提高 `PRESIGN_TTL_SECONDS`，或重新載入頁面取得新 URL |
| multipart 上傳合併失敗 | CORS 的 `ExposeHeaders` 缺少 `etag` |
| 登入後立刻被登出 | `AUTH_SECRET` 未設定，或 Production 與 Preview 用了不同值而 cookie 跨環境共用 |

---

## 8. 金鑰外洩時的處置

1. **R2**：Cloudflare → R2 → Manage R2 API Tokens → 刪除該 token → 建立新的 → 更新 `R2_ACCESS_KEY_ID` 與 `R2_SECRET_ACCESS_KEY` → 重新部署
2. **Neon**：Neon Console → 該 branch 的 Roles → Reset password → 更新兩條連線字串 → 重新部署
3. **AUTH_SECRET**：產生新值 → 更新 → 重新部署（兩人需重新登入）

更換金鑰不會影響已儲存的素材與資料。
