-- 角色出場從正文推導出來，而且分得出是小說還是劇本（P0-1）。
--
-- episode_characters 一直是空的：整個程式碼庫只有三個 SELECT，沒有任何
-- 地方 INSERT。所以沈知味從 EP001 就登場，頁面上卻寫「出現於 0 集」。
--
-- 加三個欄位而不是另開一張表：
--   from_novel / from_script  推導來的，重跑同步會重算
--   manual                    人自己加的，同步永遠不動它
--
-- 需要 manual 是因為推導只看得到名字。一個角色在揭曉之前以「那個男人」
-- 出現，正文裡沒有他的名字——那種出場只有人標得出來，而那正是最需要
-- 標的那一種。
ALTER TABLE "episode_characters"
  ADD COLUMN IF NOT EXISTS "from_novel" boolean NOT NULL DEFAULT false;

ALTER TABLE "episode_characters"
  ADD COLUMN IF NOT EXISTS "from_script" boolean NOT NULL DEFAULT false;

ALTER TABLE "episode_characters"
  ADD COLUMN IF NOT EXISTS "manual" boolean NOT NULL DEFAULT false;

-- 已經存在的列（目前沒有）視為人工標記，不要被同步洗掉。
UPDATE "episode_characters"
   SET "manual" = true
 WHERE "from_novel" = false AND "from_script" = false;
