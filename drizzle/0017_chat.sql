-- 即時對話（Z99）。
--
-- Vercel 沒辦法維持常駐 WebSocket，所以投遞走 SSE、輪詢備援。
-- 那件事決定了這個 schema 的形狀：每一筆客戶端需要知道的變動都帶一個
-- 單調遞增的 seq，重新連上的客戶端只要問「比這個號碼新的給我」，
-- 不用重抓整串對話。
--
-- 為什麼不用時間戳當游標：同一毫秒進來的兩則訊息分不出先後，
-- 重連的客戶端不是漏一則就是重播一則。
--
-- 全部是新增，沒有一行會動到既有資料。

CREATE TYPE "message_kind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'FILE', 'CALL');
CREATE TYPE "call_state" AS ENUM ('RINGING', 'ACTIVE', 'ENDED', 'MISSED', 'DECLINED');

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL DEFAULT '',
  "last_seq" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "conversation_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "read_seq" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_members_unique" UNIQUE ("conversation_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "conversation_members_user_idx"
  ON "conversation_members" ("user_id");

CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "sender_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "seq" integer NOT NULL,
  "kind" "message_kind" NOT NULL DEFAULT 'TEXT',
  "body" text NOT NULL DEFAULT '',
  -- 沒有外鍵，與這個 schema 裡其他 30 個 asset 參照一致；
  -- 改由送出的路徑驗證歸屬與上傳狀態。
  "asset_id" uuid,
  "duration_sec" integer,
  "reply_to_id" uuid,
  -- 收回是清空 body 留著列，不是刪列：
  -- 對方畫面上可能已經有它，而序號出現空洞會讓重連的客戶端以為自己漏了。
  "recalled_at" timestamptz,
  "edited_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "messages_conversation_seq" UNIQUE ("conversation_id", "seq")
);
CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx"
  ON "messages" ("conversation_id", "created_at");
-- 歷史搜尋走 body；pg_trgm 在 0007 已經裝好。
CREATE INDEX IF NOT EXISTS "messages_body_idx"
  ON "messages" USING gin ("body" gin_trgm_ops);

-- 一人一列、心跳覆寫，不是 append-only：
-- 沒有人需要昨天的上線狀態，而那種紀錄會為了一分鐘後就沒價值的資訊無限長大。
CREATE TABLE IF NOT EXISTS "presence" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "typing_in_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
  "typing_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "caller_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "video" text NOT NULL DEFAULT 'false',
  "state" "call_state" NOT NULL DEFAULT 'RINGING',
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "calls_conversation_idx"
  ON "calls" ("conversation_id", "created_at");

-- WebRTC 的 offer / answer / ICE 暫存。
-- 之所以要落地而不是直接轉送：SSE 連線在 Vercel 上每分鐘會斷一次，
-- 重連期間送達的 candidate 會消失——那會讓通話失敗而且沒有任何錯誤訊息。
CREATE TABLE IF NOT EXISTS "call_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_id" uuid NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
  "from_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "to_user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "payload" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "call_signals_to_idx"
  ON "call_signals" ("to_user_id", "created_at");
