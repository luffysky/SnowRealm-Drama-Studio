-- 大綱相關的 AI 任務類型。
--
-- Postgres 的 enum 只能新增值，不能在交易裡新增後立刻使用，
-- 所以這裡只做 ADD VALUE，程式端用到的時候已經是另一個交易了。
-- IF NOT EXISTS 讓這個 migration 可以重跑。
ALTER TYPE "ai_job_kind" ADD VALUE IF NOT EXISTS 'OUTLINE_GENERATE' AFTER 'PROJECT_PLAN';--> statement-breakpoint
ALTER TYPE "ai_job_kind" ADD VALUE IF NOT EXISTS 'OUTLINE_REVIEW' AFTER 'OUTLINE_GENERATE';
