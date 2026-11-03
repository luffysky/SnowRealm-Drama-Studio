# 81–90 素材資產中心｜差異報告

依 `SnowRealm_Drama_Studio_UI_81-90_Spec_v3.1.md` §7：
「正式開發前請先盤點現有 App Router、Neon Schema、R2、授權、素材元件及可用 AI 供應商，提交差異報告，再分階段實作。」

盤點日期：2026-11-04。以實際執行結果為準，不是讀程式碼推論。

---

## 1. 結論先講

**P0 的地基大半已經在了。** 上傳、R2、權限、簽章讀取、多段上傳、預覽檔這一整條管線是通的而且實測過。
缺的主要是**音訊這一層的領域模型**：分類、版本變體、授權、集數關聯、專輯。

真正要討論的只有一件事：**規格 §3 的資料表拆法跟現有 schema 衝突**，見 §4。

---

## 2. 已經有、可直接沿用

| 規格要的 | 現況 | 備註 |
| --- | --- | --- |
| R2 私有儲存、短效授權 | ✅ 實測全通過 | `npm run r2:check`：CORS、multipart、取消不留物件、拿掉簽章讀不到 |
| 上傳意圖 → 直傳 → 核對 | ✅ `/api/uploads` → PUT → `/api/uploads/complete` | 後端 HEAD 核對大小與存在才標 COMPLETED |
| 大檔不經 Vercel Function | ✅ | 瀏覽器直傳；>64 MB 自動多段，分段大小隨檔案調整 |
| 上傳中斷可重試／清理 | ✅ | 單段失敗只重簽該段；`upload_sessions` 記錄狀態；有 `purge-stale-uploads` |
| 試聽／下載經後端授權 | ✅ `/api/files/[assetId]` | 檢查 session 後 307 到短效簽章網址 |
| 六大分類 | ✅ `asset_kind` enum | IMAGE / VIDEO / MUSIC / VOICE / SFX / DOC / STICKER / NOVEL_ATTACHMENT / OTHER |
| 波形預計算有地方放 | ✅ `asset_variants.kind = 'WAVEFORM'` | enum 已經有這個值，目前沒人寫入 |
| 預覽檔 | ✅ | 圖片已做（母片＋壓縮版）；音訊可沿用同一條路 |
| 素材關聯集數／場次／鏡頭 | ⚠️ 部分 `asset_links` | 多型 (entity_type, entity_id, slot)，已用於 shot 的 first_frame / last_frame |
| 版本 | ⚠️ 部分 `assets.version` + `root_asset_id` | 只有 revision 這個維度，沒有 variant |
| 稽核 | ⚠️ 部分 `activities` | 已記錄 actor / entity / project / action |
| RBAC | ✅ | `asset.upload` / `asset.write` / `asset.delete`（後者 OWNER only） |
| B+ 路由與作品分頁 | ✅ | `/projects/[projectId]/...` + `ProjectWorkspaceChrome` |

`assets` 現有欄位：`id, project_id, episode_id, kind, name, object_key, mime_type, size_bytes, duration_sec, width, height, checksum, version, root_asset_id, upload_status, tags[], note, license, generation_meta, uploaded_by_id, deleted_at`。

---

## 3. 規格要、目前沒有

| 規格資料表 | 現況 | 缺什麼 |
| --- | --- | --- |
| `audio_metadata` | ❌ | category(OP/ED/BGM/角色曲/插曲)、genre_tags、mood_tags、language、artist、bpm、musical_key、source_platform。目前只有一個 `tags[]` 字串陣列，撐不起 82 的篩選 |
| `audio_revisions` | ⚠️ 一半 | `variant`（full / instrumental / short / vocal）這個維度完全沒有。85 的核心就是它 |
| `audio_segments` | ❌ | 片段標記（毫秒整數） |
| `asset_licenses` | ❌ | 目前授權只有 `assets.license` 一個 text 欄位。88 要的是：權利人、來源平台、授權類型、允許用途、地域、期限起訖、使用限制、審核人、狀態 |
| `asset_license_documents` | ❌ | 授權 PDF 的關聯 |
| `project_audio_defaults` | ❌ | 作品 OP/ED 預設 |
| `episode_audio_overrides` | ❌ | 單集 繼承／替換／停用 |
| `episode_audio_cues` | ❌ | 89 的時間軸：track_type、timeline_start_ms、source_start/end_ms、volume_db、fade_in/out_ms |
| `voice_line_links` | ❌ | 配音綁台詞；台詞改版要標 `needs_review` |
| `soundtrack_albums` / `_tracks` / `_releases` | ❌ | 90 全部 |
| `assets.scope`（project / studio） | ❌ | 86 要工作室共用音效，目前 `project_id` 是 NOT NULL，沒有共用的概念 |
| `assets.title` | ❌ | 目前只有 `name`＝原始檔名。82 要可編輯的曲名 |
| 元件 `src/components/assets/` | ❌ | 整個目錄不存在。規格列的十個共用元件都沒有 |
| 路由 `/assets/*` | ❌ | 分頁上「素材管理」目前標 M3 未實作 |

---

## 4. 需要你決定：資料表拆法衝突

規格 §3 同時說了兩件互相牴觸的事：

> 表格列出 `assets` 與 `asset_files` 分離、`audio_revisions` 獨立持有 `file_id`
>
> 但同一節開頭又說：**「優先擴充現有 assets/asset_versions，不得建立兩套重複素材系統」**

現有 schema 是**一張 `assets` 自己帶 `object_key` + `version` + `root_asset_id`**，而且分鏡、角色、費用、封面全都直接指向 `assets.id`（30 個參照欄位）。

照規格把檔案拆成 `asset_files`，等於要動到已經在用的那 30 個參照，而且會出現「asset 沒有檔案」的中間狀態。

**建議（待你確認）**：保留 `assets` 當檔案本體，新增的音訊表都指向 `assets.id`：

```
assets  (既有，不動)
  ├─ audio_metadata      (asset_id PK)         ← 82 的分類與篩選
  ├─ audio_revisions     (asset_id, revision, variant, file_asset_id)
  │                        revision 用既有 root_asset_id 鏈，variant 是新維度
  ├─ audio_segments      (audio_revision_id)
  ├─ asset_licenses      (asset_id, audio_revision_id?)
  └─ asset_license_documents (license_id, file_asset_id)
```

這樣「不建立兩套素材系統」成立，而 85 要的 variant 維度也有地方放。

---

## 5. AI 供應商現況

| 用途 | 現況 | 規格階段 |
| --- | --- | --- |
| 文字（Claude） | ✅ 可用、已實測 | — |
| 語意檢索（Voyage） | ✅ 可用、已實測、已校準 | — |
| 圖片生成 | ❌ enum 有 `IMAGE_GENERIC`，adapter 回 null | 不在 81–90 範圍 |
| 影片生成 | ❌ 同上；輪詢前置已完成（`AWAITING_PROVIDER` + `external_job_id`） | 不在 81–90 範圍 |
| TTS 配音 | ❌ `TTS_GENERIC` 未實作 | **87 列為 P2「有可用 API 才做」** |
| 音樂生成 | ❌ | 88 把 Suno AI 當主要來源平台 |

### Suno 這件事要先講清楚

**Suno 目前沒有公開的官方 API。** 2026 年 7 月官方表示正在規劃開發者 API，採邀請制早期存取，沒有公布時程。

市面上的「Suno API」全是第三方逆向包裝（sunoapi.org、AIMLAPI 之類）。對這個專案的問題不是能不能接，是**授權**——而 88 整頁就是在管授權：

- 逆向包裝的服務本身不是 Suno 授權的
- 用它產出的音樂，商用權利在你跟 Suno 的 EULA，不在那個包裝商
- 設計稿 88 寫「Suno 方案授權資料已補全（28 件）」，這在法務上是**訂閱不等於無條件著作權**，規格 §2-88 自己也這樣寫了

**建議**：88 的資料模型照建（它本來就是要記錄「來源平台 + 當時方案 + 條款證據」），但不要接任何第三方 Suno API。音樂先走「手動上傳 + 記錄來源與授權」，這正好是 P0 的範圍。要自動生成音樂再另外評估有官方 API 的供應商。

### TTS（87，P2）

規格寫「只在確認供應商 API、費用及授權後啟用；語音克隆需聲音本人明確同意，V1 預設不開放」。

實測資料指出：繁體中文／臺灣腔的實際表現各家差很多，規格表上看不出來。
成本在整體帳單裡是零頭（全書約 18 萬字，$2–$18），所以**選型應該只看聲音品質，不要看價格**。
要做的時候建議一次接兩三家、用你自己的對白實測再決定，adapter 介面寫成可換的。

---

## 6. 建議的實作順序

照規格 §6，但把已完成的扣掉：

**P0（地基其實已經好了，主要是建模與頁面）**
1. `assets` 加 `title`、`scope`；新增 `audio_metadata`、`asset_licenses`、`asset_license_documents`
2. 81 總覽（真實數量與容量，不是假數字）
3. 82 音樂庫（伺服器端分頁／搜尋／篩選）
4. 84 新增／編輯（沿用既有上傳管線，加音訊 metadata 解析）
5. 83 波形播放（wavesurfer.js；失敗退化為原生 `<audio>`，不顯示假波形）
6. 88 授權紀錄基礎

**P1**
85 版本（含 variant 維度）、86 音效（含 studio scope）、87 真人配音、89 時間軸配置、90 專輯

**P2 以後**
87 的 AI TTS、89 多軌同步預覽

---

## 7. 我需要你回答的

1. **§4 的資料表拆法**：照我建議的「擴充 assets」，還是照規格原文拆出 `asset_files`？
2. **音樂來源**：先只做手動上傳＋授權紀錄（建議），還是要我評估有官方 API 的音樂生成供應商？
3. **先做哪一頁**：建議 81 → 82 → 84 → 83，照規格 §6 的順序。
