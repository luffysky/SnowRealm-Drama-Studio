-- AI 助理搬出共用對話（Z100 修正）。
--
-- 助理原本住在兩個人的對話裡，用 @助理 叫醒。那樣的後果不是「位置不對」，
-- 是「問模型的話跟跟同事說的話在同一條捲軸裡」——兩者的讀者不同、歷史不同，
-- 混在一起之後助理的上下文就是他們兩個人的上下文。
--
-- 所以對話分種類：DIRECT 是兩個人的，ASSISTANT 是某一個人跟 AI 的。
-- ASSISTANT 的成員只有擁有者一個，所以每條路由原本的 assertMember 照樣成立。
DO $$ BEGIN
  CREATE TYPE "conversation_kind" AS ENUM ('DIRECT', 'ASSISTANT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "kind" "conversation_kind" NOT NULL DEFAULT 'DIRECT';

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "owner_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;

-- 既有的那一列就是兩個人的對話，維持 DIRECT / owner_id NULL，不用動。

CREATE INDEX IF NOT EXISTS "conversations_owner_idx"
  ON "conversations" ("owner_id", "kind", "updated_at");
