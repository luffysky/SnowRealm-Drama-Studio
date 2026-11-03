# 待辦清單｜2026-11-04

以實際檢查為準（git status、程式碼 grep、資料庫、檔案系統），不是憑印象。
工作區乾淨，所有已完成的都已 commit 並 push。

---

## A. 做到一半 —— 最需要注意的

這一類的危險在於**看起來像做完了**。

### A1. 影片生成的輪詢：只有資料庫，沒有 worker

- ✅ `ai_jobs.external_job_id` 欄位、`AWAITING_PROVIDER` 狀態（migration 0012，已上線）
- ❌ `src/lib/ai/queue.ts` **完全沒有用到這兩個東西**

現況是資料庫認得這個狀態，worker 不認得。任何媒體任務進到 `AWAITING_PROVIDER`
都不會被撿回來跑。commit 訊息寫的是「前置」，但欄位已經在正式資料庫裡了。

**要做**：`claimJobs()` 把 `AWAITING_PROVIDER` 當可認領、
`runDueJobs()` 看到 `external_job_id` 有值就去輪詢而不是重送、
而且**輪詢不可以累加 `attempt_count`**（不然一支三分鐘的影片三次輪詢就耗盡重試次數）。

### A2. AI 媒體供應商：一個 adapter 都沒有

- ✅ enum 有 `IMAGE_GENERIC` / `VIDEO_GENERIC` / `TTS_GENERIC`
- ✅ `adapterFor()` 回 `null`，UI 顯示「這類供應商尚未實作適配器」（誠實，不是假裝可用）
- ❌ 實際的 adapter 零個

你已經決定：圖片 aggregator ＋ Gemini 兩個都接、影片 image-to-video 與
text-to-video 都要、Seedance 走 aggregator。**這些都還沒開始**，被 81–90 插隊。

### A3. 搜尋索引不會自動更新

只有「改作品設定」會觸發 reindex。寫小說、改大綱、改角色、改世界觀**都不會**。
目前要手動按搜尋面板右下角的「重建索引」。

### A4. AI 選取選單只接了小說編輯器

`ScriptEditor` 沒有 `onAiAction`。劇本裡選一段字不會浮出 AI 選單，小說會。
模組設定裡 `aiSelection` 對兩個介面都預設開啟，所以這是不一致而不是刻意。

### A5. 預覽檔只做了圖片

`useUploader` 只對 `IMAGE` / `STICKER` 產生壓縮版。
音訊的波形（`asset_variants.kind = 'WAVEFORM'` 這個值已經存在）沒有人寫入，
影片也沒有縮圖。83 要用到波形。

### A6. 缺四個公開圖片資產

`public/` 底下缺 `login-bg.png`、`logo-mark.png`、`rail-foot.png`、`hero-banner.png`。
目前用漸層或 placeholder 頂著（刻意做成看起來像設計，不是破圖）。

---

## B. 81–90 素材資產中心

- ✅ **P0 Schema**（migration 0013）：`assets.title`、`audio_metadata`、
  `audio_revisions`、`asset_licenses`、`asset_license_documents`
- ❌ **所有頁面**：`src/components/assets/` 這個目錄還不存在，`/assets/*` 路由一條都沒有
- ❌ P1 資料表：`audio_segments`、`project_audio_defaults`、`episode_audio_overrides`、
  `episode_audio_cues`、`voice_line_links`、`soundtrack_albums` / `_tracks` / `_releases`
- ⏸ `assets.scope`（project / studio）：**刻意不做**，理由見 V3.1 §3 的修訂註記
  （`project_id` 是 NOT NULL 且權限檢查、R2 路徑全部經過它，
  現在加等於放一個繞過權限的洞）

下一步照既定順序：**81 → 82 → 84 → 83 → 88 基礎**。

---

## C. 既有里程碑裡還沒做的

### M1
- 新增作品表單
- 集數編輯、集數詳情頁
- 集數列表的其他檢視模式
- 作品卡的「更多操作」

### M2（AI 對話框）
- 38–43 提示詞範本
- 44–49 比較檢視的細項
- 50–56 小說轉劇本的完整流程

### M3
- 12 分鏡工作台、13 鏡頭詳情
- 14 / 15 / 16 素材管理（**可能已被 81–90 取代，待確認**）

### M4
- 審核發布、跨作品任務、成本中心、團隊管理、系統設定、個人設定
- 通知中心、說明中心
- 完整動態列表

---

## D. 等你的東西

1. **02 登入頁設計稿**：你說過改了，但 `UI Design/02_login.png` 還是舊的那張。
   我沒有重做登入頁。
2. **朝代名稱與 120 集正典**：先前說「2 後面定」，還沒定。
3. **TTS 供應商**：要實測繁體中文／臺灣腔之後再選，adapter 會寫成可換的。
4. **14/15/16 素材管理**：81–90 是不是完全取代它們？

---

## E. 已完成且實測過（不在待辦內，列出來對照）

- 登入、作品、集數、小說／劇本編輯器（TipTap，模組可開關）
- 世界觀、角色、版本紀錄、製作進度
- AI 創作助手（接真實佇列，估算 → 產生 → 比對 → 採用）
- 分集大綱 ＋ AI 生成大綱
- RAG 語意檢索（Voyage，門檻已用 `scripts/search-calibrate.ts` 量過校準）
- R2 上傳（直傳、多段、重試、取消）、圖片母片＋預覽檔
- 作品封面上傳更換、小說／短劇分名
- 編輯器章節目錄、尋找取代、AI 選取選單（僅小說）
- `scripts/db-verify.ts` schema 對帳、`scripts/shots.mjs` RWD 截圖
