-- 集號在一部作品裡唯一，不是在一卷裡唯一（Z148）。
--
-- 原本只有 `episodes_arc_number_key`，也就是 `(arc_id, number)`。那在每部
-- 作品只有一卷的時候跟「作品內唯一」是同一件事——但 Z128 讓卷可以新增、
-- 集數可以搬動之後就不是了：**卷一有 EP007、卷二再建一個 EP007，資料庫
-- 會收下。**
--
-- 而正文裡每一句「第 007 集」、小說、劇本、分鏡、有聲書全部指這個號碼。
-- 兩集同號之後那些參照就沒有答案了，而且**不會有任何地方報錯**——查詢照
-- 樣回傳，只是回傳兩筆。
--
-- `where deleted_at is null`：軟刪除掉的集數不該占著號碼不放，否則刪掉
-- EP007 之後就永遠補不回一個 EP007。
--
-- 套用前查過兩個資料庫都沒有重複（Neon 240 集、測試庫 120 集）。有重複的
-- 話這道指令會失敗而不是默默改資料——那是對的：哪一集該改號是人的決定。
CREATE UNIQUE INDEX IF NOT EXISTS "episodes_project_number_idx"
  ON "episodes" ("project_id", "number")
  WHERE "deleted_at" IS NULL;
