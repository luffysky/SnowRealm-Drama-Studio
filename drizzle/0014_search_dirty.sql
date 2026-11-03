-- 索引落後的標記。
--
-- 內容一改就重建索引是錯的：小說編輯器每 2.5 秒自動存檔一次，
-- 而 embedding 是按 token 計費的——等於替「正在打字的句子」付錢。
--
-- 所以寫入時只標記（一個便宜的 UPDATE），實際重建交給 cron 或手動按鈕。
-- NULL 代表索引是最新的。
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "search_dirty_at" timestamp with time zone;--> statement-breakpoint

-- 只有落後的專案要掃，所以用部分索引。
CREATE INDEX IF NOT EXISTS "projects_search_dirty_idx"
  ON "projects" ("search_dirty_at") WHERE "search_dirty_at" IS NOT NULL;
