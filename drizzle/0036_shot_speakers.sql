-- 一個鏡頭可以有好幾個人說話 (Z194).
--
-- `shots.speaker_id` 是一個 uuid，所以「沈知味與錢管事在同一鏡對話」這件事
-- 本來只能拆成兩鏡來記。改成關聯表。
--
-- **這支遷移是純新增的**：舊欄位留著不動，現在線上的程式照常跑。所以可以先
-- 跑遷移、之後再部署，中間不會有任何一邊壞掉。`shots.speaker_id` 之後另外
-- 開一支遷移丟掉（Z195），不要在同一支裡做——那會讓這兩個順序都有一段壞的。

CREATE TABLE IF NOT EXISTS "shot_speakers" (
	"shot_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	-- 說話順序。對白是一句接一句的，誰先開口有差。
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shot_speakers_pk" PRIMARY KEY("shot_id","character_id")
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "shot_speakers" ADD CONSTRAINT "shot_speakers_shot_id_shots_id_fk"
		FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 角色被刪掉時連帶拿掉這一列，效果等同舊欄位的 `on delete set null`：
-- 那個鏡頭就少一個說話人，而不是留著一個指向空氣的 id。
DO $$ BEGIN
	ALTER TABLE "shot_speakers" ADD CONSTRAINT "shot_speakers_character_id_characters_id_fk"
		FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shot_speakers_shot_idx" ON "shot_speakers" ("shot_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shot_speakers_character_idx" ON "shot_speakers" ("character_id");--> statement-breakpoint

-- 既有的說話人搬過來。`on conflict` 是為了讓這支可以重跑。
INSERT INTO "shot_speakers" ("shot_id","character_id","sort_order")
SELECT "id", "speaker_id", 0 FROM "shots" WHERE "speaker_id" IS NOT NULL
ON CONFLICT DO NOTHING;
