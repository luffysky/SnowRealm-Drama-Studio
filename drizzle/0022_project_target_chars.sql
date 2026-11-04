-- 單集目標字數變成作品的欄位（Z98）。
--
-- 原本是 `targetChars={4000}` 直接寫在 JSX 裡，連常數都不是。
-- 4000 字大概是一集 120–180 秒短劇的量，但那是**這部戲**的節奏；
-- 第二部如果走別的路數就不是這個數字，而改它現在要重新部署。
--
-- 放在 projects 而不是 app_settings：它跟 target_min_sec / target_max_sec
-- 是同一類東西——那兩個早就是欄位了，字數沒有道理不是。
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "target_chars" integer NOT NULL DEFAULT 4000;
