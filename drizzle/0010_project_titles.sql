-- 同一部作品，小說名稱與短劇名稱可以不同。
--
-- 一份製作、兩個產品：小說上架用一個書名，短劇發行用另一個，是常見做法。
--
-- 預設空字串而不是把 title 複製進去：複製過去之後，作品名稱改了，
-- 這兩個欄位會默默停在舊名字。空字串的意思很明確——「跟作品名稱相同」，
-- 讀取一律經過 src/lib/project-titles.ts，不要直接讀欄位。
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "novel_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "drama_title" text DEFAULT '' NOT NULL;
