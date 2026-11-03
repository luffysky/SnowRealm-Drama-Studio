# 智慧語意檢索（RAG Retrieval）

右上角那個搜尋框。輸入「女主角第一次拒絕訂單的那段」也找得到，就算那段文字裡
沒有出現「拒絕」「訂單」這些字。

---

## 1. 為什麼不是單純的關鍵字搜尋

這個專案的內容是繁體中文長文：120 集小說、劇本、世界觀、角色設定。
兩個現成做法都不夠：

| 做法 | 為什麼不行 |
| --- | --- |
| `LIKE '%字%'` | 要使用者先猜對用字。寫作的人記得的是情境，不是字面 |
| `to_tsvector` 全文檢索 | PostgreSQL 內建的分詞不處理中文，「碼頭的訂單」整串變成一個 token，索引等於沒建 |

所以採混合檢索（hybrid search）：

- **語意（semantic）**：把文字轉成向量，比對意思。由 Voyage AI 的 `voyage-4` 產生。
- **關鍵字（lexical）**：`pg_trgm` 的三連字相似度。對中文有效，而且不需要外部服務。

兩邊同時跑，分數合併：`semantic × 0.65 + lexical × 0.35`。
兩邊都命中的結果排在只命中一邊的前面——對這個規模的語料，
這是 reciprocal rank fusion 便宜但有效的版本。

---

## 2. 資料結構

一個表，`search_documents`，一列一段（chunk）：

| 欄位 | 用途 |
| --- | --- |
| `project_id` | 作品隔離。每一次查詢都以此為條件，不靠前端 |
| `kind` | `PROJECT` / `EPISODE` / `CHAPTER` / `SCENE` / `WORLD_ENTRY` / `WORLD_EVENT` / `CHARACTER` |
| `ref_id` | 來源列的 id |
| `parent_ref_id` | 章節與場景所屬的集數。沒有它，搜到一段小說只能連到列表頁 |
| `chunk_index` | 同一來源切成多段時的序號 |
| `content` | 實際被 embed 的純文字（HTML 已剝除） |
| `embedding` | `real[]`，1024 維。未設定金鑰時為 NULL |
| `content_hash` | 內容沒變就不重算向量。這是唯一的成本控制 |

所有可搜尋的東西都攤平成同一個形狀，搜尋不需要認識九張表，
而加第十種來源是改 indexer，不是改查詢。

### 為什麼 `real[]` 而不是 pgvector

Neon 有 pgvector 0.8.6，本機測試用的 embedded-postgres 沒有。
一個 `vector(1024)` 欄位會讓 migration 在本機直接失敗，而讓兩個環境的
schema 長得不一樣比慢一點更糟。

以這個專案的規模（數千列）逐列算餘弦距離是毫秒等級。餘弦函式由
migration `0008_search_index.sql` 以 plpgsql 定義，維度不符或零向量回傳 0。

長到十萬列以上再換成 `vector(1024)` 並建 ivfflat 索引即可，查詢介面不用改。

---

## 3. 切段（chunking）

700 字一段，重疊 100 字，盡量切在段落邊界。

- 太長：一段裡塞進太多主題，向量被平均掉，什麼都搜得到也就等於什麼都搜不到。
- 太短：失去上下文，「他答應了」沒有前文根本不知道在講什麼。
- 重疊：避免一句關鍵描述剛好被切在接縫上。

---

## 4. 成本

Voyage 按 token 計費。控制方式只有一個，但很有效：**內容沒變就不重算向量**。

`reindexProject()` 比對 `content_hash`，只對變動或新增的段落呼叫 API，
回傳值裡的 `embedded` 就是這次實際花錢的段數。
整本重新索引一次 120 集的小說，和存一次檔之後再索引一次，
後者應該是 `embedded: 1~2`。

查詢端每次只 embed 一個字串（使用者輸入），成本可忽略。

> `input_type` 不是可選的。Voyage 對 document 和 query 會加上不同的前綴指令，
> 混用會明顯降低檢索品質。索引時傳 `document`，查詢時傳 `query`。

---

## 5. 沒有金鑰的時候

`VOYAGE_API_KEY` 沒設定時：

- `embed()` 回傳 `null`，不丟錯。
- `embedding` 欄位留 NULL，索引照建（關鍵字那半仍然可用）。
- 查詢退回純 trigram 比對。
- **搜尋面板明說「僅關鍵字（尚未設定 VOYAGE_API_KEY）」。**

最後一條是重點。靜靜地少給結果比直接說做不到更糟——使用者會以為
那段文字不存在。

測試套件也刻意把這個金鑰清掉（`tests/setup.ts`），
`npm test` 永遠不會產生 API 費用。

---

## 6. 介面

- `⌘K` / `Ctrl+K` 開啟，`Esc` 關閉，`↑↓` 選擇，`Enter` 開啟。
- 在作品工作區內預設只搜當前作品，一鍵可擴大到全部作品。
- 類型篩選（集數／小說／劇本／角色／世界觀／時間線／作品）。
- 每一筆結果標記是「語意」「關鍵字」還是兩者都中。
- 腳註顯示索引狀態，並提供「重建索引」。

---

## 7. API

| 端點 | 用途 |
| --- | --- |
| `GET /api/search?q=…` | 跨作品搜尋。範圍由 `visibleProjects()` 決定，不由請求決定 |
| `GET /api/projects/[id]/search?q=…` | 單一作品搜尋 |
| `GET /api/projects/[id]/search/reindex` | 索引狀態（段數、已向量化段數、最後更新時間） |
| `POST /api/projects/[id]/search/reindex` | 重建索引。回傳 `{ indexed, embedded, skipped }` |

跨作品那支的作品範圍一律在伺服器端取交集：
請求指名一個看不到的作品，結果是那個作品被濾掉，不是被接受
（`docs/ROUTES.md` §5、§8）。

---

## 8. 還沒做

- **自動重新索引**：目前要手動按「重建索引」。存檔時自動排入佇列會更好，
  但那需要一個背景任務，而 Hobby 方案的 cron 是一天一次。
- **素材與任務**：這兩類還沒有內容可索引（M3／M4）。`SearchKind` 加兩個值、
  `collect()` 加兩段查詢就能接上。
- **AI 問答**：目前只做檢索（R），還沒接生成（AG）。檢索結果餵給 Claude
  做「問這部作品」是下一步，資料層已經就緒。
