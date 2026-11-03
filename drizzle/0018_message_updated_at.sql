-- 訊息的「修改」也要能即時推送（Z99 的協定漏洞）。
--
-- 原本的協定只有一句話：「比這個序號新的給我」。那處理得了新增，
-- 處理不了修改——收回與編輯不會改 seq（改了訊息會跳到對話最底下，是錯的），
-- 所以對方永遠收不到，要重新整理才看得見。
--
-- 加一個 updated_at：串流改成抓「seq 比較新 **或** 這次同步之後被改過」的訊息。
-- 客戶端本來就是用 id 合併，同一則被推兩次會正確覆蓋。
--
-- 既有的列用 created_at 當初值，那是它們最後一次變動的時間。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;
UPDATE "messages" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "messages" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "updated_at" SET DEFAULT now();

CREATE INDEX IF NOT EXISTS "messages_conversation_updated_idx"
  ON "messages" ("conversation_id", "updated_at");
