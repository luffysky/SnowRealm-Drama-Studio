-- AI 助理（Z100）。
--
-- 長在對話系統上：助理是對話裡的一個發話者，不是另一套介面。
-- messages、SSE 推送、歷史搜尋、長按選單全部直接重用。
--
-- **平時完全不動作。** 只有訊息以 @ 標記或 / 指令開頭才會觸發——
-- 不是每則訊息都送給模型。那同時解決了兩件事：花費，以及它不會插話。

-- 誰說的。原本只有 sender_id，而「AI 說的」跟「成員的帳號被刪了」
-- 在那個欄位上長得一模一樣（都是 null）。
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "from_assistant" boolean NOT NULL DEFAULT false;

-- 助理的回覆是哪則訊息觸發的。串起來才知道一輪對話的範圍，
-- 也才算得出那一輪花了多少。
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "replies_to_id" uuid;

-- 助理改東西的提案。
--
-- **它永遠不直接寫。** 改的是一份副本，原值留在 before_value，
-- 由人決定要不要取代。套用的時候先把當下的內容存成 versions 快照，
-- 所以「取代」跟「取代並備份」其實是同一條路徑——備份不是選項，
-- 是套用的一部分。不備份而覆蓋，等於讓模型有權刪掉人寫的東西。
CREATE TABLE IF NOT EXISTS "assistant_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  -- 產生這個提案的那則助理訊息。
  "message_id" uuid REFERENCES "messages"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE,
  -- 'chapter' | 'episode_outline' | 'character' | 'world_entry'
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  -- 改哪一個欄位，例如 'content'、'synopsis'、'personality'
  "field" text NOT NULL,
  "before_value" text NOT NULL DEFAULT '',
  "after_value" text NOT NULL DEFAULT '',
  -- 助理自己說明改了什麼、為什麼
  "rationale" text NOT NULL DEFAULT '',
  -- PENDING | APPLIED | REJECTED | STALE
  "state" text NOT NULL DEFAULT 'PENDING',
  -- 套用時建立的 versions 快照，也就是原版的備份
  "backup_version_id" uuid,
  "decided_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "assistant_proposals_conversation_idx"
  ON "assistant_proposals" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "assistant_proposals_target_idx"
  ON "assistant_proposals" ("target_type", "target_id", "state");
