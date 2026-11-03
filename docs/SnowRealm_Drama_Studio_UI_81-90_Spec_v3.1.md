# SnowRealm Drama Studio｜UI 81–90 開發規格 V3.1

**性質**：V3.0 完整規格的增補文件，非已完成功能。**優先原則**：B+ 導覽；URL `projectId` 是作品脈絡；後端 RBAC；Neon 存資料，私有 Cloudflare R2 存檔案。只有暖寶 CEO 與 Luffysky CTO 兩名真人帳號。示意圖中的歌曲、數字、授權、發行與收益不可當作真實資料。

## 1. 頁面與路由

|編號|設計檔名|路由（均位於 `/projects/[projectId]` 下）|元件|階段|
|---|---|---|---|---|
|81|`81_asset_center_overview`|`/assets`|`AssetCenterOverview.tsx`|P0|
|82|`82_music_library`|`/assets/music`|`MusicLibrary.tsx`|P0|
|83|`83_audio_player_waveform`|`/assets/music/[assetId]`|`AudioPlayerWaveform.tsx`|P0|
|84|`84_music_metadata_form`|`/assets/music/new`、`/assets/music/[assetId]/edit`|`MusicMetadataForm.tsx`|P0|
|85|`85_music_version_manager`|`/assets/music/[assetId]/versions`|`MusicVersionManager.tsx`|P1|
|86|`86_sound_effect_library`|`/assets/sfx`|`SoundEffectLibrary.tsx`|P1|
|87|`87_voice_asset_library`|`/assets/voice`|`VoiceAssetLibrary.tsx`|P1／AI生成P2|
|88|`88_audio_license_manager`|`/assets/licenses`|`AudioLicenseManager.tsx`|P0基礎、P1進階|
|89|`89_audio_episode_linker`|`/assets/audio-links`|`AudioEpisodeLinker.tsx`|P1／同步預覽P2|
|90|`90_soundtrack_album_manager`|`/assets/albums`|`SoundtrackAlbumManager.tsx`|P1／發行整合P3|

元件均置於 `src/components/assets/`。App Router 頁面置於 `src/app/(studio)/projects/[projectId]/...`。沿用既有 `ProjectWorkspaceLayout` 和作品分頁，不增加第二套作品側欄。

## 2. 逐頁功能與驗收

### 81 素材資產中心總覽
- 顯示圖片、影片、音樂、音效、配音、文件六類的真實數量、容量、近期上傳、授權待審及素材使用摘要。
- 分類卡可進清單；最近項目可開詳情；新增按鈕開共用上傳流程。
- **驗收**：空庫顯示0；上傳MP3後計數與最近項目更新；不同作品資料隔離。

### 82 音樂素材庫
- OP、ED、插曲、BGM、角色曲等分類；搜尋、情緒/風格/授權篩選、排序、伺服器端分頁及列表/卡片檢視。
- 每筆顯示曲名、時長、版本、授權狀態、來源及關聯；真實試聽、詳情、編輯、版本管理。
- 作品預設適用120集不等於120次已發布使用，分別顯示。
- **驗收**：搜尋/分頁重整仍有效；無音檔不顯示假曲目；無權者不可試聽。

### 83 音樂播放器與波形
- 真實播放、暫停、音量、拖曳定位、循環、片段試聽、標記與版本切換；可採wavesurfer.js。
- 波形由真實音訊解碼或預計算；失敗時退化為原生播放器，不能顯示假波形。
- 片段以毫秒整數儲存，`0 <= start < end <= duration`，只保存設定不直接剪出新檔。
- **驗收**：播放與波形同步；標記重整後仍存在；私有音訊URL短效且可安全更新。

### 84 音樂新增／編輯
- MP3/WAV/FLAC上傳（其他格式需實測後啟用）、封面、曲名、簡介、分類、風格、情緒、語言、演唱者、來源與授權資料。
- 時長/大小/格式從檔案解析；BPM/調性可選填，估算結果要標註；草稿、進度、失敗重試。
- 新音樂授權預設待確認；檔案未完成不可顯示可使用；付費AI封面需先確認成本。
- **驗收**：R2有真實檔案、Neon有紀錄、重整可播放；失敗可恢復或清理。

### 85 音樂版本管理
- 分開`revision`（v1/v2）與`variant`（full/instrumental/short/vocal）；各版本有獨立檔案、時長、checksum、授權與審核。
- 波形/時長/備註比較、切換試聽、設定預設版本、封存；雙音訊精準同步屬進階。
- 已發布集數固定當時版本，切換預設不得靜默修改。
- **驗收**：上傳新版後舊版仍可播放；被引用版本不可直接永久刪除。

### 86 音效素材庫
- 環境、動作、料理、道具、轉場、特效分類；搜尋、標籤、卡片/列表、試聽、版本及來源授權。
- `scope=project`作品專屬或`scope=studio`工作室共用；共享需有權限與授權。
- 可關聯集數、場次、鏡頭、時間區間，不重複存音檔。
- **驗收**：上傳短音效並試聽、搜尋、關聯EP005；作品隔離正確。

### 87 配音素材庫
- 角色/旁白/場次/台詞分類；真人音檔上傳、試聽、版本、審核及劇本台詞ID/版本關聯。
- 台詞修改後對應配音標記`needs_review`。
- AI TTS只在確認供應商API、費用及授權後啟用；語音克隆需聲音本人明確同意，V1預設不開放。
- **驗收**：配音可綁定台詞，台詞改版後提示重新審核；無API不顯示假生成成功。

### 88 音樂／音效／配音授權管理
- 保存權利人、來源、取得方式、用途/媒介/地域/期限/限制、審核人、證明文件及變更歷史。
- 狀態：待審、已確認、受限制、過期、拒絕；新上傳預設待審。
- 到期提醒與受影響集數查詢；Suno等AI生成須記錄生成日期、當時方案與條款證據，訂閱不等於無條件著作權。
- **驗收**：未審不顯示已授權；期限/用途不符有警示；文件後端驗權。

### 89 音樂與集數關聯
- 作品OP/ED預設、單集繼承/替換/停用；集數搜尋、分頁、批次套用；場次/鏡頭Cue。
- 軌道OP/ED、BGM、SFX、VOICE；保存指定音訊版本、時間軸起點、來源起訖、音量與淡入淡出。
- V1只做配置、基本預覽與匯出規格，不承諾完整DAW、多軌即時混音或影片渲染。
- **驗收**：EP005新增BGM cue、重整保留；來源區間不超過檔案長度；發布快照鎖定版本。

### 90 OST音樂專輯管理
- 建立OST/EP/Single/角色合輯，封面、簡介、曲目順序、指定音訊版本、發行日期/狀態。
- 同一歌曲可進多專輯而不複製檔案；外部發行商、平台連結可手動記錄。
- 自動發行、串流收益同步、版稅對帳、實體CD/黑膠為P3；沒有來源就顯示「尚無資料」。
- **驗收**：建立專輯、加入兩首歌、調整排序、重整保留；刪除專輯不刪音檔。

## 3. Neon邏輯資料模型

**先檢查既有Schema，優先擴充現有assets/asset_versions，不得建立兩套重複素材系統。**

|實體|關鍵欄位與約束|
|---|---|
|`assets`|id, project_id nullable, scope(project/studio), type, title, status, created_by, deleted_at|
|`asset_files`|id, asset_id, r2_key, mime_type, size_bytes, sha256, duration_ms, upload_status|
|`audio_metadata`|asset_id, category, genre_tags, mood_tags, language, artist, bpm nullable, musical_key nullable, source_platform|
|`audio_revisions`|id, asset_id, revision, variant, file_id, review_status|
|`audio_segments`|id, audio_revision_id, label, start_ms, end_ms；start<end且不超音檔時長|
|`asset_licenses`|id, asset_id, audio_revision_id nullable, status, rights_holder, source, allowed_uses, territories, valid_from, valid_until, restrictions, reviewed_by|
|`asset_license_documents`|id, license_id, file_id, document_type|
|`project_audio_defaults`|project_id, role(OP/ED), audio_revision_id, enabled；unique(project_id,role)|
|`episode_audio_overrides`|episode_id, role, mode(inherit/replace/disable), audio_revision_id nullable；unique(episode_id,role)|
|`episode_audio_cues`|id, episode_id, scene_id nullable, shot_id nullable, track_type, audio_revision_id, timeline_start_ms, source_start_ms, source_end_ms, volume_db, fade_in_ms, fade_out_ms|
|`voice_line_links`|audio_revision_id, character_id, script_dialogue_line_id, script_version_id, review_status|
|`soundtrack_albums`|id, project_id, title, type, cover_asset_id, release_status, release_date|
|`soundtrack_album_tracks`|album_id, audio_revision_id, track_number；unique(album_id,track_number)|
|`soundtrack_releases`|album_id, platform, external_url, distributor, release_status|
|`asset_audit_events`|actor_id, project_id, asset_id, action, created_at；不記錄憑證|

所有關聯必須驗證作品歸屬或工作室共享權限；發布時保存不可變引用快照。金額使用精確decimal，時間用整數毫秒；刪除優先soft-delete，引用中檔案禁止直接永久刪除。

## 4. R2與API規格

**上傳流程**：後端驗證使用者、作品權限、格式與大小 → 核發短效上傳授權 → 瀏覽器直傳私有R2 → 後端核對物件存在、大小、類型 → Neon標記ready。上傳中斷需可重試/清理；大檔避免經Vercel Function中轉。試聽/下載必須經後端授權後核發短效URL。波形可由前端真實解碼或背景任務預計算。圖片標示的2GB不可當成已驗證限制。

建議API（依既有專案風格整合，避免重複）：

```text
GET  /api/projects/:projectId/assets?type=&q=&page=&pageSize=
POST /api/projects/:projectId/assets/upload-intent
POST /api/projects/:projectId/assets/complete-upload
GET/PATCH /api/projects/:projectId/assets/:assetId
POST /api/projects/:projectId/assets/:assetId/preview-url
POST /api/projects/:projectId/assets/:assetId/revisions
GET/POST /api/projects/:projectId/assets/:assetId/segments
GET/POST/PATCH /api/projects/:projectId/licenses
GET/PUT /api/projects/:projectId/audio-defaults
GET/PUT /api/projects/:projectId/episodes/:episodeId/audio
GET/POST/PATCH /api/projects/:projectId/albums
```

所有寫入需schema validation、RBAC、projectId歸屬檢查、必要交易與稽核。列表使用伺服器分頁；批次操作需報告部分失敗。

## 5. 共用元件與UI狀態

共用：`AssetUploadDialog`、`AssetLibraryFilters`、`AudioPlayer`、`AudioWaveform`、`AudioSegmentEditor`、`AudioMetadataEditor`、`AudioRevisionSelector`、`AudioLicensePanel`、`AudioCueTimeline`、`SoundtrackTrackList`。

每頁支援loading、empty、error、forbidden；上傳另有uploading、processing、failed、ready；授權有pending_review、approved、restricted、expired。所有表單需取消、儲存、驗證與防重複送出。示意圖中的歌曲、波形、授權、發行與收益不可當成正式資料。

## 6. 開發順序與端到端驗收

1. **P0基礎**：檢查現有Schema與B+路由 → 共用上傳/權限/R2/Neon → 81、82、84、83 → 88基本授權紀錄。
2. **P1管理**：85版本、86音效、87真人配音、89配置時間軸、90專輯基本管理。
3. **P2整合**：87 AI TTS（有可用API才做）、89多軌同步預覽與進階時間軸。
4. **P3外部**：90發行商API、平台報表/收益、實體商品（另立規格）。

**必過驗收測試**：以真實MP3上傳R2 → Neon建立資料 → 音樂庫搜尋 → 波形播放 → 修改資訊 → 新增第二版本 → 綁定EP005 Cue → 重整後資料仍存在 → 權限阻擋另一作品 → 授權待審狀態正確 → 封存版本不破壞引用。再以一段SFX及一段配音測試共用管線。提供實際截圖、測試結果、改動檔案及未完成項目；不得以靜態Demo冒充完成。

## 7. 與V3.0的相容及交付

- 保留01–80原有編號及路由；舊素材管理入口轉到81資產中心或對應分類。
- 81–90均為**新增編號**，總設計數90。視覺稿僅供外觀參考，B+導覽與實際資料契約優先。
- 正式開發前請Claude先盤點現有App Router、Neon Schema、R2、授權、素材元件及可用AI供應商，提交差異報告，再分階段實作。
