-- 每一段對白是誰說的（Z132）。
--
-- 為什麼要存而不是每次重算：它是花錢問模型問出來的，而且人會想改其中幾句。
-- 跟 `episode_characters` 同一個形狀——推導出來的可以重算覆蓋，人改過的不動。
--
-- 鍵是（集數, 段號）。段號是 `novelForReading()` 展平之後的索引，所以它跟
-- 閱讀器、朗讀、有聲書看到的是同一套編號；正文改了段落數會變，那時這張表的
-- 內容就過期了——所以 `source` 記得住是誰下的判斷，重跑時才知道哪些能蓋。
CREATE TABLE IF NOT EXISTS "episode_line_speakers" (
  "episode_id"      uuid NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "paragraph_index" integer NOT NULL,
  -- NULL 代表「確定沒有歸屬」——旁白唸。跟「還沒判斷過」（沒有這一列）不同。
  "character_id"    uuid REFERENCES "characters"("id") ON DELETE CASCADE,
  -- 模型照正文寫出的稱呼，用於角色表裡還沒有這個人的時候。
  "spoken_as"       text NOT NULL DEFAULT '',
  -- 'rule' 規則判的、'model' 模型判的、'manual' 人改的。manual 永遠不被覆蓋。
  "source"          text NOT NULL DEFAULT 'model',
  "confidence"      numeric(4, 3),
  "ai_job_id"       uuid REFERENCES "ai_jobs"("id") ON DELETE SET NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("episode_id", "paragraph_index")
);

CREATE INDEX IF NOT EXISTS "episode_line_speakers_character_idx"
  ON "episode_line_speakers" ("character_id");
