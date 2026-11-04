-- 對話的附件不該躺在素材庫裡（Z116）。
--
-- 聊天室的語音訊息、圖片、檔案都走同一條上傳管線，所以一則語音訊息會變成
-- 一筆 kind='VOICE' 的資產，然後出現在「素材資產中心 › 配音」——跟真正要
-- 拿去配音的素材排在一起。
--
-- 用 origin 而不是另外開一個 kind：那段錄音**就是**一段語音，聊天氣泡也
-- 是照 kind 決定怎麼顯示的。會變的不是它是什麼，是它屬於哪裡。
DO $$ BEGIN
  CREATE TYPE "asset_origin" AS ENUM ('LIBRARY', 'CHAT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "assets"
  ADD COLUMN IF NOT EXISTS "origin" "asset_origin" NOT NULL DEFAULT 'LIBRARY';

CREATE INDEX IF NOT EXISTS "assets_origin_idx" ON "assets" ("project_id", "origin", "kind");

-- 已經存在的對話附件：被訊息引用的就是從對話來的。
UPDATE "assets" a
   SET "origin" = 'CHAT'
  FROM "messages" m
 WHERE m."asset_id" = a."id";
