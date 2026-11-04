-- 歌詞：貼上／上傳，以及「播到哪歌詞走到哪」（Z125）。
--
-- 存成一個 text 欄位而不是一張逐行的表：
--   * LRC（每行前面掛 [mm:ss.xx]）本來就是卡拉 OK 與音樂播放器通用的格式，
--     在這裡匯出的檔案別的工具打得開，別的地方做好的也貼得進來。
--   * 它是純文字。時間碼錯了看得懂也改得動；自訂的 JSON 結構只有這個 app 讀得懂。
--   * 拆成列買不到任何東西——沒有任何查詢是針對單一句歌詞的，整份載入、
--     解析一次、在瀏覽器裡跟著跑。
--
-- 沒有時間碼的純文字歌詞也存在這裡，播放器會照實顯示但不跟著走——
-- 那是格式的限制，說清楚比假裝有同步好。
ALTER TABLE "audio_metadata"
  ADD COLUMN IF NOT EXISTS "lyrics" text NOT NULL DEFAULT '';

ALTER TABLE "audio_metadata"
  ADD COLUMN IF NOT EXISTS "lyrics_updated_at" timestamp with time zone;
